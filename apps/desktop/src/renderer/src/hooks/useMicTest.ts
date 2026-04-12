import { useCallback, useEffect, useRef, useState } from "react";

interface UseMicTestOptions {
  inputDeviceId?: string;
  outputDeviceId?: string;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
  preferredSampleRate?: "auto" | "44100" | "48000";
  monitorMode?: "processed" | "raw";
}

interface UseMicTestResult {
  isTesting: boolean;
  level: number;
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
}: UseMicTestOptions): UseMicTestResult => {
  const [isTesting, setIsTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string>();
  const streamRef = useRef<MediaStream>();
  const contextRef = useRef<AudioContext>();
  const destinationRef = useRef<MediaStreamAudioDestinationNode>();
  const outputGainRef = useRef<GainNode>();
  const analyserRef = useRef<AnalyserNode>();
  const audioRef = useRef<HTMLAudioElement>();
  const rafRef = useRef<number>();

  const stop = useCallback(() => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }

    analyserRef.current?.disconnect();
    destinationRef.current?.disconnect();
    outputGainRef.current?.disconnect();
    analyserRef.current = undefined;
    destinationRef.current = undefined;
    outputGainRef.current = undefined;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current = undefined;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;

    void contextRef.current?.close().catch(() => undefined);
    contextRef.current = undefined;
    setLevel(0);
    setIsTesting(false);
  }, []);

  const startMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) {
      return;
    }

    const sampleBuffer = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(sampleBuffer);
      let peak = 0;

      for (const value of sampleBuffer) {
        const normalized = Math.abs((value - 128) / 128);
        peak = Math.max(peak, normalized);
      }

      setLevel(Math.min(1, peak * 2.4));
      rafRef.current = window.requestAnimationFrame(tick);
    };

    tick();
  }, []);

  const start = useCallback(async () => {
    stop();
    setError(undefined);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: inputDeviceId ? { exact: inputDeviceId } : undefined,
          echoCancellation: monitorMode === "processed" ? echoCancellation : false,
          noiseSuppression: monitorMode === "processed" ? noiseSuppression : false,
          autoGainControl: monitorMode === "processed" ? autoGainControl : false,
          sampleRate: preferredSampleRate === "auto" ? undefined : Number(preferredSampleRate),
          channelCount: 1,
        },
      });

      const context = new AudioContext({
        sampleRate: preferredSampleRate === "auto" ? undefined : Number(preferredSampleRate),
        latencyHint: "interactive",
      });
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const outputGain = context.createGain();
      outputGain.gain.value = 1;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(outputGain);
      outputGain.connect(analyser);

      const destination = context.createMediaStreamDestination();
      outputGain.connect(destination);

      const audio = new Audio();
      audio.autoplay = true;
      audio.muted = false;
      audio.volume = 1;
      audio.srcObject = destination.stream;

      if (outputDeviceId && "setSinkId" in audio) {
        await (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(
          outputDeviceId,
        );
      }

      streamRef.current = stream;
      contextRef.current = context;
      analyserRef.current = analyser;
      destinationRef.current = destination;
      outputGainRef.current = outputGain;
      audioRef.current = audio;

      await audio.play();
      setIsTesting(true);
      startMeter();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      stop();
      throw nextError;
    }
  }, [
    autoGainControl,
    echoCancellation,
    inputDeviceId,
    monitorMode,
    noiseSuppression,
    outputDeviceId,
    preferredSampleRate,
    startMeter,
    stop,
  ]);

  const toggle = useCallback(async () => {
    if (isTesting) {
      stop();
      return;
    }

    await start();
  }, [isTesting, start, stop]);

  useEffect(() => stop, [stop]);

  return {
    isTesting,
    level,
    error,
    start,
    stop,
    toggle,
  };
};
