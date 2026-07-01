import type { AppSettings, MicEqualizerGains } from "@private-voice/shared";

export const MICROPHONE_EQ_FREQUENCIES = [
  80,
  250,
  1_000,
  4_000,
  12_000,
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
  isLowCutEnabled = true,
): AudioNode => {
  let currentNode = source;
  const normalizedGains = normalizeEqualizerGains(gains);

  if (isLowCutEnabled) {
    const lowCut = context.createBiquadFilter();
    lowCut.type = "highpass";
    lowCut.frequency.value = 80;
    lowCut.Q.value = 0.707;
    currentNode.connect(lowCut);
    currentNode = lowCut;
  }

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

const connectAdaptiveNoiseGate = async (
  context: AudioContext,
  source: AudioNode,
): Promise<AudioNode> => {
  if (!context.audioWorklet) {
    return source;
  }

  const moduleSource = `
    class ShangHaoNoiseGate extends AudioWorkletProcessor {
      constructor() {
        super();
        this.gain = 1;
        this.noiseFloor = 0.003;
      }

      process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !output) return true;
        const channel = input[0];
        if (!channel) return true;

        let sum = 0;
        for (let i = 0; i < channel.length; i += 1) sum += channel[i] * channel[i];
        const rms = Math.sqrt(sum / Math.max(1, channel.length));
        if (rms < this.noiseFloor * 2.4) {
          this.noiseFloor = this.noiseFloor * 0.994 + rms * 0.006;
        }
        const threshold = Math.max(0.0075, this.noiseFloor * 2.9);
        const target = rms >= threshold ? 1 : 0.12;
        const smoothing = target > this.gain ? 0.3 : 0.045;
        this.gain += (target - this.gain) * smoothing;

        for (let channelIndex = 0; channelIndex < output.length; channelIndex += 1) {
          const inputChannel = input[channelIndex] || channel;
          const outputChannel = output[channelIndex];
          for (let i = 0; i < outputChannel.length; i += 1) {
            outputChannel[i] = (inputChannel[i] || 0) * this.gain;
          }
        }
        return true;
      }
    }
    registerProcessor("shanghao-noise-gate", ShangHaoNoiseGate);
  `;
  const moduleUrl = URL.createObjectURL(
    new Blob([moduleSource], { type: "application/javascript" }),
  );
  try {
    await context.audioWorklet.addModule(moduleUrl);
    const gate = new AudioWorkletNode(context, "shanghao-noise-gate", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    source.connect(gate);
    return gate;
  } catch {
    return source;
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
};

export const createProcessedMicrophoneStream = async (
  inputStream: MediaStream,
  settings: Pick<
    AppSettings,
    "micEqualizerGains" | "preferredSampleRate" | "isLowCutEnabled" | "isNoiseSuppressionEnabled"
  >,
): Promise<ProcessedMicrophoneStream> => {
  const gains = normalizeEqualizerGains(settings.micEqualizerGains);
  if (
    gains.every((gain) => gain === 0) &&
    !settings.isLowCutEnabled &&
    !settings.isNoiseSuppressionEnabled
  ) {
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
  const filtered = connectMicrophoneEqualizer(
    context,
    source,
    gains,
    settings.isLowCutEnabled,
  );
  const output = settings.isNoiseSuppressionEnabled
    ? await connectAdaptiveNoiseGate(context, filtered)
    : filtered;
  output.connect(destination);

  return {
    stream: destination.stream,
    dispose: () => {
      inputStream.getTracks().forEach((track) => track.stop());
      destination.stream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => undefined);
    },
  };
};
