import { useCallback, useEffect, useRef, useState } from "react";

interface UseMicTestOptions {
  inputDeviceId?: string;
  outputDeviceId?: string;
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
}: UseMicTestOptions): UseMicTestResult => {
  const [isTesting, setIsTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string>();
  const audioRef = useRef<HTMLAudioElement>();
  const streamRef = useRef<MediaStream>();
  const contextRef = useRef<AudioContext>();
  const analyserRef = useRef<AnalyserNode>();
  const rafRef = useRef<number>();

  const stop = useCallback(() => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
    }

    analyserRef.current?.disconnect();
    analyserRef.current = undefined;

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

    const sampleBuffer = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(sampleBuffer);
      let peak = 0;

      for (const value of sampleBuffer) {
        const normalized = Math.abs((value - 128) / 128);
        if (normalized > peak) {
          peak = normalized;
        }
      }

      setLevel(Math.min(1, peak * 2.6));
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
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const audio = new Audio();
      audio.autoplay = true;
      audio.muted = false;
      audio.volume = 1;
      audio.srcObject = stream;

      if (outputDeviceId && "setSinkId" in audio) {
        await (audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }).setSinkId?.(
          outputDeviceId,
        );
      }

      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);

      streamRef.current = stream;
      audioRef.current = audio;
      contextRef.current = context;
      analyserRef.current = analyser;

      await audio.play();
      setIsTesting(true);
      startMeter();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
      stop();
      throw nextError;
    }
  }, [inputDeviceId, outputDeviceId, startMeter, stop]);

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
