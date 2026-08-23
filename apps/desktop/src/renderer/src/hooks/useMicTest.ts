import { useCallback, useEffect, useRef, useState } from "react";

import {
  MICROPHONE_PROCESSING_SAMPLE_RATE,
  type LowCutFrequency,
  type MicEqualizerGains,
} from "@private-voice/shared";

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
  error?: string;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => Promise<void>;
  playSystemCapture: () => Promise<void>;
  playProcessed: () => Promise<void>;
}

const TEST_DURATION_MS = 9_000;
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
  const [error, setError] = useState<string>();
  const inputStreamRef = useRef<MediaStream | undefined>(undefined);
  const processedStreamRef = useRef<ProcessedMicrophoneStream | undefined>(undefined);
  const contextRef = useRef<AudioContext | undefined>(undefined);
  const analyserRef = useRef<AnalyserNode | undefined>(undefined);
  const playbackRef = useRef<HTMLAudioElement | undefined>(undefined);
  const recordingTimerRef = useRef<number | undefined>(undefined);
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
    if (recordingTimerRef.current !== undefined) window.clearTimeout(recordingTimerRef.current);
    recordingTimerRef.current = undefined;
    releaseCapture();
    clearPlayback(true);
    setPhase("idle");
    setIsClipping(false);
  }, [clearPlayback, releaseCapture]);

  const startMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const samples = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(samples);
      let peak = 0;
      for (const value of samples) peak = Math.max(peak, Math.abs((value - 128) / 128));
      setLevel(Math.min(1, peak * 2.4));
      if (peak >= 0.98) setIsClipping(true);
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
      recorder.start(500);
      return { recorder, done };
    },
    [],
  );

  const start = useCallback(async () => {
    stop();
    setError(undefined);
    setIsClipping(false);
    try {
      const inputStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
          echoCancellation,
          noiseSuppression: false,
          autoGainControl,
          sampleRate: MICROPHONE_PROCESSING_SAMPLE_RATE,
          channelCount: 1,
        },
      });
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
      processedStreamRef.current = processedStream;

      const context = new AudioContext({
        sampleRate: MICROPHONE_PROCESSING_SAMPLE_RATE,
        latencyHint: "interactive",
      });
      await context.resume();
      contextRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(processedStream.stream).connect(analyser);
      analyserRef.current = analyser;
      startMeter();

      const systemRecording = recordStream(inputStream);
      const processedRecording = recordStream(processedStream.stream);
      setPhase("recording");
      recordingTimerRef.current = window.setTimeout(async () => {
        systemRecording.recorder.stop();
        processedRecording.recorder.stop();
        const [systemBlob, processedBlob] = await Promise.all([
          systemRecording.done,
          processedRecording.done,
        ]);
        releaseCapture();
        urlsRef.current = {
          system: URL.createObjectURL(systemBlob),
          processed: URL.createObjectURL(processedBlob),
        };
        setPhase("ready");
      }, TEST_DURATION_MS);
    } catch (cause) {
      const friendly = toUserFacingError(cause, "audio");
      setError(`${friendly.title}：${friendly.description}`);
      void window.desktopApi.app.writeLog({
        category: "audio",
        level: "error",
        message: "microphone_test_failed",
        context: { error: technicalErrorMessage(cause), inputDeviceId, outputDeviceId },
      });
      releaseCapture();
      setPhase("idle");
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
    start,
    stop,
    toggle,
    playSystemCapture: () => play("system"),
    playProcessed: () => play("processed"),
  };
};
