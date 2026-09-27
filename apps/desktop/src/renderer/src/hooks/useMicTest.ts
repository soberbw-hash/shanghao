import { useCallback, useEffect, useRef, useState } from "react";

import {
  MICROPHONE_PROCESSING_SAMPLE_RATE,
  type LowCutFrequency,
  type MicEqualizerGains,
} from "@private-voice/shared";
import { requestMicrophoneStream } from "@private-voice/webrtc";

import {
  createProcessedMicrophoneStream,
  type ProcessedMicrophoneStream,
} from "../features/audio/microphoneProcessor";
import { technicalErrorMessage, toUserFacingError } from "../utils/userFacingError";

interface UseMicTestOptions {
  inputDeviceId?: string;
  outputDeviceId?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  voiceEnhancement?: boolean;
  monitorMode?: "processed" | "raw";
  equalizerGains?: number[];
  lowCutFrequency?: LowCutFrequency;
}

export type MicTestPhase = "idle" | "recording" | "ready" | "playing_system" | "playing_processed";

interface UseMicTestResult {
  isTesting: boolean;
  phase: MicTestPhase;
  level: number;
  isClipping: boolean;
  remainingSeconds?: number;
  error?: string;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => Promise<void>;
  playSystemCapture: () => Promise<void>;
  playProcessed: () => Promise<void>;
}

export const MIC_TEST_DURATION_SECONDS = 3;
const TEST_DURATION_MS = MIC_TEST_DURATION_SECONDS * 1_000;
const METER_UPDATE_INTERVAL_MS = 80;
const recorderMimeType = (): string | undefined =>
  ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((type) =>
    MediaRecorder.isTypeSupported(type),
  );

export const useMicTest = ({
  inputDeviceId,
  outputDeviceId,
  echoCancellation = true,
  noiseSuppression = true,
  autoGainControl = true,
  voiceEnhancement = true,
  equalizerGains = [],
  lowCutFrequency = "75",
}: UseMicTestOptions): UseMicTestResult => {
  const [phase, setPhase] = useState<MicTestPhase>("idle");
  const [level, setLevel] = useState(0);
  const [isClipping, setIsClipping] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState<number>();
  const [error, setError] = useState<string>();
  const inputStreamRef = useRef<MediaStream | undefined>(undefined);
  const processedStreamRef = useRef<ProcessedMicrophoneStream | undefined>(undefined);
  const contextRef = useRef<AudioContext | undefined>(undefined);
  const analyserRef = useRef<AnalyserNode | undefined>(undefined);
  const playbackRef = useRef<HTMLAudioElement | undefined>(undefined);
  const recordingTimerRef = useRef<number | undefined>(undefined);
  const countdownTimerRef = useRef<number | undefined>(undefined);
  const recordingSessionRef = useRef(0);
  const recordersRef = useRef<MediaRecorder[]>([]);
  const rafRef = useRef<number | undefined>(undefined);
  const urlsRef = useRef<{ system?: string; processed?: string }>({});

  const clearMeter = useCallback(() => {
    if (rafRef.current !== undefined) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = undefined;
    analyserRef.current?.disconnect();
    analyserRef.current = undefined;
    setLevel(0);
  }, []);

  const releaseCapture = useCallback(() => {
    clearMeter();
    processedStreamRef.current?.dispose();
    processedStreamRef.current = undefined;
    inputStreamRef.current?.getTracks().forEach((track) => track.stop());
    inputStreamRef.current = undefined;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = undefined;
  }, [clearMeter]);

  const clearPlayback = useCallback((revokeUrls: boolean) => {
    playbackRef.current?.pause();
    playbackRef.current = undefined;
    if (revokeUrls) {
      if (urlsRef.current.system) URL.revokeObjectURL(urlsRef.current.system);
      if (urlsRef.current.processed) URL.revokeObjectURL(urlsRef.current.processed);
      urlsRef.current = {};
    }
  }, []);

  const stop = useCallback(() => {
    recordingSessionRef.current += 1;
    if (recordingTimerRef.current !== undefined) window.clearTimeout(recordingTimerRef.current);
    recordingTimerRef.current = undefined;
    if (countdownTimerRef.current !== undefined) window.clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = undefined;
    for (const recorder of recordersRef.current) {
      if (recorder.state === "recording") {
        try {
          recorder.stop();
        } catch {
          // The source may already have ended; continue releasing the other resources.
        }
      }
    }
    recordersRef.current = [];
    releaseCapture();
    clearPlayback(true);
    setPhase("idle");
    setRemainingSeconds(undefined);
    setIsClipping(false);
  }, [clearPlayback, releaseCapture]);

  const startMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const samples = new Uint8Array(analyser.fftSize);
    let nextMeterUpdateAt = 0;
    let clippingReported = false;
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const value of samples) peak = Math.max(peak, Math.abs((value - 128) / 128));
      const now = performance.now();
      if (now >= nextMeterUpdateAt) {
        setLevel(Math.min(1, peak * 2.4));
        nextMeterUpdateAt = now + METER_UPDATE_INTERVAL_MS;
      }
      if (peak >= 0.98 && !clippingReported) {
        clippingReported = true;
        setIsClipping(true);
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const recordStream = useCallback(
    (stream: MediaStream): { recorder: MediaRecorder; done: Promise<Blob> } => {
      const chunks: BlobPart[] = [];
      const mimeType = recorderMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const done = new Promise<Blob>((resolve, reject) => {
        recorder.addEventListener(
          "dataavailable",
          (event) => event.data.size && chunks.push(event.data),
        );
        recorder.addEventListener("error", () => reject(new Error("mic_test_recording_failed")), {
          once: true,
        });
        recorder.addEventListener(
          "stop",
          () => resolve(new Blob(chunks, { type: recorder.mimeType })),
          { once: true },
        );
      });
      // The second recorder can fail before the timer awaits both recordings.
      void done.catch(() => undefined);
      recorder.start(500);
      return { recorder, done };
    },
    [],
  );

  const start = useCallback(async () => {
    stop();
    const session = recordingSessionRef.current;
    setError(undefined);
    setIsClipping(false);
    try {
      // Match the room capture path, including the native-rate retry for virtual microphones.
      const { stream: inputStream } = await requestMicrophoneStream({
        deviceId: inputDeviceId,
        echoCancellation,
        noiseSuppression: false,
        autoGainControl,
      });
      if (session !== recordingSessionRef.current) {
        inputStream.getTracks().forEach((track) => track.stop());
        return;
      }
      inputStreamRef.current = inputStream;
      const processedStream = await createProcessedMicrophoneStream(inputStream.clone(), {
        micEqualizerGains: Array.from(
          { length: 5 },
          (_, index) => equalizerGains[index] ?? 0,
        ) as MicEqualizerGains,
        lowCutFrequency,
        isNoiseSuppressionEnabled: noiseSuppression,
        isVoiceEnhancementEnabled: voiceEnhancement,
      });
      if (session !== recordingSessionRef.current) {
        processedStream.dispose();
        return;
      }
      processedStreamRef.current = processedStream;

      const context = new AudioContext({
        sampleRate: MICROPHONE_PROCESSING_SAMPLE_RATE,
        latencyHint: "interactive",
      });
      await context.resume();
      if (session !== recordingSessionRef.current) {
        void context.close().catch(() => undefined);
        return;
      }
      contextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(processedStream.stream).connect(analyser);
      analyserRef.current = analyser;
      startMeter();

      const systemRecording = recordStream(inputStream);
      recordersRef.current.push(systemRecording.recorder);
      const processedRecording = recordStream(processedStream.stream);
      recordersRef.current.push(processedRecording.recorder);
      const deadline = performance.now() + TEST_DURATION_MS;
      setRemainingSeconds(MIC_TEST_DURATION_SECONDS);
      setPhase("recording");
      countdownTimerRef.current = window.setInterval(() => {
        if (session !== recordingSessionRef.current) return;
        setRemainingSeconds(Math.max(1, Math.ceil((deadline - performance.now()) / 1_000)));
      }, 200);
      recordingTimerRef.current = window.setTimeout(async () => {
        recordingTimerRef.current = undefined;
        if (countdownTimerRef.current !== undefined)
          window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = undefined;
        setRemainingSeconds(undefined);
        try {
          for (const recorder of recordersRef.current) {
            if (recorder.state === "recording") recorder.stop();
          }
          recordersRef.current = [];
          const [systemBlob, processedBlob] = await Promise.all([
            systemRecording.done,
            processedRecording.done,
          ]);
          if (session !== recordingSessionRef.current) return;
          releaseCapture();
          urlsRef.current = {
            system: URL.createObjectURL(systemBlob),
            processed: URL.createObjectURL(processedBlob),
          };
          setPhase("ready");
        } catch (cause) {
          if (session !== recordingSessionRef.current) return;
          stop();
          const friendly = toUserFacingError(cause, "audio");
          setError(`${friendly.title}：${friendly.description}`);
        }
      }, TEST_DURATION_MS);
    } catch (cause) {
      if (session !== recordingSessionRef.current) return;
      const friendly = toUserFacingError(cause, "audio");
      setError(`${friendly.title}：${friendly.description}`);
      void window.desktopApi.app.writeLog({
        category: "audio",
        level: "error",
        message: "microphone_test_failed",
        context: { error: technicalErrorMessage(cause), inputDeviceId, outputDeviceId },
      });
      stop();
    }
  }, [
    autoGainControl,
    echoCancellation,
    equalizerGains,
    inputDeviceId,
    outputDeviceId,
    lowCutFrequency,
    noiseSuppression,
    recordStream,
    releaseCapture,
    startMeter,
    stop,
    voiceEnhancement,
  ]);

  const play = useCallback(
    async (kind: "system" | "processed") => {
      const url = urlsRef.current[kind];
      if (!url) return;
      clearPlayback(false);
      const audio = new Audio(url);
      playbackRef.current = audio;
      if (outputDeviceId && "setSinkId" in audio) {
        await (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
          .setSinkId(outputDeviceId)
          .catch(() => undefined);
      }
      audio.addEventListener("ended", () => setPhase("ready"), { once: true });
      setPhase(kind === "system" ? "playing_system" : "playing_processed");
      await audio.play();
    },
    [clearPlayback, outputDeviceId],
  );

  const toggle = useCallback(async () => {
    if (phase === "recording") stop();
    else await start();
  }, [phase, start, stop]);

  useEffect(() => stop, [stop]);

  return {
    isTesting: phase !== "idle",
    phase,
    level,
    isClipping,
    error,
    remainingSeconds,
    start,
    stop,
    toggle,
    playSystemCapture: () => play("system"),
    playProcessed: () => play("processed"),
  };
};
