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

export type MicTestPhase = "idle" | "monitoring";

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
  const audioRef = useRef<HTMLAudioElement>();
  const rafRef = useRef<number>();

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

  const stop = useCallback(() => {
    releaseCapture();

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current = undefined;
    }
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
      const normalizedLevel = Math.min(1, peak * 2.4);
      setLevel(normalizedLevel);
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
      const monitoredStream = processedStream?.stream ?? inputStream;

      const context = new AudioContext({
        sampleRate: preferredSampleRate === "auto" ? undefined : Number(preferredSampleRate),
        latencyHint: "interactive",
      });
      await context.resume();
      contextRef.current = context;
      const source = context.createMediaStreamSource(monitoredStream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const audio = new Audio();
      audioRef.current = audio;
      audio.srcObject = monitoredStream;
      audio.autoplay = true;
      audio.volume = 1;
      if (outputDeviceId && "setSinkId" in audio) {
        await (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> })
          .setSinkId(outputDeviceId)
          .catch(() => undefined);
      }
      await audio.play();
      setPhase("monitoring");
      startMeter();
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
