import type { AppSettings, MicEqualizerGains } from "@private-voice/shared";

export const MICROPHONE_EQ_FREQUENCIES = [
  31,
  62,
  125,
  250,
  500,
  1_000,
  2_000,
  4_000,
  8_000,
  16_000,
] as const;

export interface ProcessedMicrophoneStream {
  stream: MediaStream;
  dispose: () => void;
}

export const normalizeEqualizerGains = (gains?: number[]): MicEqualizerGains =>
  Array.from({ length: MICROPHONE_EQ_FREQUENCIES.length }, (_, index) => {
    const gain = gains?.[index];
    return typeof gain === "number" && Number.isFinite(gain)
      ? Math.max(-12, Math.min(12, gain))
      : 0;
  }) as MicEqualizerGains;

export const connectMicrophoneEqualizer = (
  context: AudioContext,
  source: AudioNode,
  gains: number[],
): AudioNode => {
  let currentNode = source;
  const normalizedGains = normalizeEqualizerGains(gains);

  MICROPHONE_EQ_FREQUENCIES.forEach((frequency, index) => {
    const filter = context.createBiquadFilter();
    filter.type =
      index === 0
        ? "lowshelf"
        : index === MICROPHONE_EQ_FREQUENCIES.length - 1
          ? "highshelf"
          : "peaking";
    filter.frequency.value = frequency;
    filter.Q.value = index === 0 || index === MICROPHONE_EQ_FREQUENCIES.length - 1 ? 0.7 : 1.05;
    filter.gain.value = normalizedGains[index] ?? 0;
    currentNode.connect(filter);
    currentNode = filter;
  });

  return currentNode;
};

export const createProcessedMicrophoneStream = async (
  inputStream: MediaStream,
  settings: Pick<AppSettings, "micEqualizerGains" | "preferredSampleRate">,
): Promise<ProcessedMicrophoneStream> => {
  const gains = normalizeEqualizerGains(settings.micEqualizerGains);
  if (gains.every((gain) => gain === 0)) {
    return {
      stream: inputStream,
      dispose: () => inputStream.getTracks().forEach((track) => track.stop()),
    };
  }

  const context = new AudioContext({
    latencyHint: "interactive",
    sampleRate:
      settings.preferredSampleRate === "auto"
        ? undefined
        : Number(settings.preferredSampleRate),
  });
  await context.resume();
  const source = context.createMediaStreamSource(inputStream);
  const destination = context.createMediaStreamDestination();
  connectMicrophoneEqualizer(context, source, gains).connect(destination);

  return {
    stream: destination.stream,
    dispose: () => {
      inputStream.getTracks().forEach((track) => track.stop());
      destination.stream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => undefined);
    },
  };
};
