import { useCallback, useEffect, useRef, useState } from "react";

import type { LowCutFrequency, MicEqualizerGains } from "@private-voice/shared";

import {
  createProcessedMicrophoneStream,
  type ProcessedMicrophoneStream,
} from "../features/audio/microphoneProcessor";

interface UseMicTestOptions {
  inputDeviceId?: string;
  outputDeviceId?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  preferredSampleRate?: "auto" | "32000" | "44100" | "48000";
  monitorMode?: "processed" | "raw";
  equalizerGains?: number[];
  lowCutFrequency?: LowCutFrequency;
}

export type MicTestPhase = "idle" | "recording" | "playback";

interface UseMicTestResult {
  isTesting: boolean;
  phase: MicTestPhase;
  level: number;
  isClipping: boolean;
  error?: string;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => Promise<void>;
}

const TEST_DURATION_MS = 5_000;

export const useMicTest = ({
  inputDeviceId,
  outputDeviceId,
  echoCancellation = true,
  noiseSuppression = true,
  autoGainControl = true,
  preferredSampleRate = "auto",
  monitorMode = "processed",
  equalizerGains = [],
  lowCutFrequency = "90",
}: UseMicTestOptions): UseMicTestResult => {
  const [phase, setPhase] = useState<MicTestPhase>("idle");
  const [level, setLevel] = useState(0);
  const [isClipping, setIsClipping] = useState(false);
  const [error, setError] = useState<string>();
  const inputStreamRef = useRef<MediaStream>();
  const processedStreamRef = useRef<ProcessedMicrophoneStream>();
  const contextRef = useRef<AudioContext>();
  const analyserRef = useRef<AnalyserNode>();
  const recorderRef = useRef<MediaRecorder>();
  const audioRef = useRef<HTMLAudioElement>();
  const objectUrlRef = useRef<string>();
  const rafRef = useRef<number>();
  const stopTimerRef = useRef<number>();

  const clearMeter = useCallback(() => {
    if (rafRef.current !== undefined) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = undefined;
    analyserRef.current?.disconnect();
    analyserRef.current = undefined;
    setLevel(0);
  }, []);

  const releaseCapture = useCallback(() => {
    if (stopTimerRef.current !== undefined) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = undefined;
    clearMeter();
    processedStreamRef.current?.dispose();
    processedStreamRef.current = undefined;
    inputStreamRef.current?.getTracks().forEach((track) => track.stop());
    inputStreamRef.current = undefined;
    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = undefined;
  }, [clearMeter]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = undefined;
    if (recorder?.state === "recording") {
      recorder.onstop = null;
      recorder.stop();
    }
    releaseCapture();

    if (audioRef.current) {
      audioRef.current.onended = null;
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = undefined;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = undefined;
    setPhase("idle");
    setIsClipping(false);
  }, [releaseCapture]);

  const startMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const sampleBuffer = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(sampleBuffer);
      let peak = 0;
      for (const value of sampleBuffer) {
        peak = Math.max(peak, Math.abs((value - 128) / 128));
      }
      setLevel(Math.min(1, peak * 2.4));
      if (peak >= 0.98) setIsClipping(true);
      rafRef.current = window.requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const start = useCallback(async () => {
    stop();
    setError(undefined);
    setIsClipping(false);

    try {
      if (typeof MediaRecorder === "undefined") throw new Error("media_recorder_unavailable");
      const inputStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
          echoCancellation: monitorMode === "processed" ? echoCancellation : false,
          noiseSuppression: false,
          autoGainControl: monitorMode === "processed" ? autoGainControl : false,
          sampleRate: preferredSampleRate === "auto" ? undefined : Number(preferredSampleRate),
          channelCount: 1,
        },
      });
      inputStreamRef.current = inputStream;

      const processedStream =
        monitorMode === "processed"
          ? await createProcessedMicrophoneStream(inputStream, {
              micEqualizerGains: Array.from(
                { length: 5 },
                (_, index) => equalizerGains[index] ?? 0,
              ) as MicEqualizerGains,
              preferredSampleRate,
              lowCutFrequency,
              isNoiseSuppressionEnabled: noiseSuppression,
            })
          : undefined;
      processedStreamRef.current = processedStream;
      const recordedStream = processedStream?.stream ?? inputStream;

      const context = new AudioContext({
        sampleRate: preferredSampleRate === "auto" ? undefined : Number(preferredSampleRate),
        latencyHint: "interactive",
      });
      await context.resume();
      contextRef.current = context;
      const source = context.createMediaStreamSource(recordedStream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const mimeType = ["audio/webm;codecs=opus", "audio/webm"].find((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      const recorder = new MediaRecorder(recordedStream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        setError("试音录制失败，请重新选择麦克风后再试。");
        stop();
      };
      recorder.onstop = () => {
        recorderRef.current = undefined;
        releaseCapture();
        if (!chunks.length) {
          setError("没有录到声音，请检查麦克风权限和输入设备。");
          setPhase("idle");
          return;
        }

        const blob = new Blob(chunks, { type: mimeType ?? "audio/webm" });
        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;
        const audio = new Audio(objectUrl);
        audioRef.current = audio;
        audio.volume = 1;
        if (outputDeviceId && "setSinkId" in audio) {
          void (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
            .setSinkId(outputDeviceId)
            .catch(() => undefined);
        }
        audio.onended = stop;
        setPhase("playback");
        void audio.play().catch((playbackError) => {
          setError(playbackError instanceof Error ? playbackError.message : String(playbackError));
          stop();
        });
      };

      recorderRef.current = recorder;
      recorder.start(250);
      setPhase("recording");
      startMeter();
      stopTimerRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, TEST_DURATION_MS);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      stop();
      throw nextError;
    }
  }, [
    autoGainControl,
    echoCancellation,
    equalizerGains,
    inputDeviceId,
    lowCutFrequency,
    monitorMode,
    noiseSuppression,
    outputDeviceId,
    preferredSampleRate,
    releaseCapture,
    startMeter,
    stop,
  ]);

  const toggle = useCallback(async () => {
    if (phase !== "idle") {
      stop();
      return;
    }
    await start();
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
  };
};
