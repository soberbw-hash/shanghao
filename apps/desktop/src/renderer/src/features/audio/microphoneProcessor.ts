import type {
  AppSettings,
  LocalAudioDiagnostics,
  LowCutFrequency,
  MicEqualizerGains,
} from "@private-voice/shared";

import rnnoiseWorkletUrl from "./rnnoiseProcessor.worklet.ts?worker&url";
import { FOURTH_ORDER_BUTTERWORTH_Q } from "./filterMath";

export const MICROPHONE_EQ_FREQUENCIES = [80, 250, 1_000, 4_000, 12_000] as const;

export interface ProcessedMicrophoneStream {
  stream: MediaStream;
  processorDiagnostics: Pick<
    LocalAudioDiagnostics,
    "noiseProcessor" | "processorOverruns" | "averageProcessingMs" | "maxProcessingMs"
  >;
  dispose: () => void;
}

interface RnnoiseNodeResult {
  node: AudioWorkletNode;
  dispose: () => void;
}

interface RnnoiseMessage {
  type?: "ready" | "failed" | "diagnostics" | "overloaded";
  error?: string;
  processorOverruns?: number;
  averageProcessingMs?: number;
  maxProcessingMs?: number;
}

const RNNOISE_INIT_TIMEOUT_MS = 5_000;

const announceBrowserFallback = (reason: string): void => {
  window.dispatchEvent(
    new CustomEvent("shanghao:audio-processor-fallback", { detail: { reason } }),
  );
};

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
  lowCutFrequency: LowCutFrequency = "90",
): AudioNode => {
  let currentNode = source;
  const normalizedGains = normalizeEqualizerGains(gains);

  if (lowCutFrequency !== "off") {
    FOURTH_ORDER_BUTTERWORTH_Q.forEach((quality) => {
      const lowCut = context.createBiquadFilter();
      lowCut.type = "highpass";
      lowCut.frequency.setValueAtTime(Number(lowCutFrequency), context.currentTime);
      lowCut.Q.setValueAtTime(quality, context.currentTime);
      currentNode.connect(lowCut);
      currentNode = lowCut;
    });
  }

  MICROPHONE_EQ_FREQUENCIES.forEach((frequency, index) => {
    const filter = context.createBiquadFilter();
    filter.type =
      index === 0
        ? "lowshelf"
        : index === MICROPHONE_EQ_FREQUENCIES.length - 1
          ? "highshelf"
          : "peaking";
    filter.frequency.setValueAtTime(frequency, context.currentTime);
    filter.Q.setValueAtTime(
      index === 0 || index === MICROPHONE_EQ_FREQUENCIES.length - 1 ? 0.7 : 1.05,
      context.currentTime,
    );
    filter.gain.setValueAtTime(normalizedGains[index] ?? 0, context.currentTime);
    currentNode.connect(filter);
    currentNode = filter;
  });

  return currentNode;
};

const enableBrowserNoiseSuppression = async (stream: MediaStream): Promise<void> => {
  const [track] = stream.getAudioTracks();
  if (!track) {
    return;
  }
  await track.applyConstraints({ noiseSuppression: true }).catch(() => undefined);
};

const createRnnoiseNode = async (
  context: AudioContext,
  inputStream: MediaStream,
  diagnostics: ProcessedMicrophoneStream["processorDiagnostics"],
): Promise<RnnoiseNodeResult> => {
  if (!context.audioWorklet) {
    throw new Error("audio_worklet_unavailable");
  }

  await context.audioWorklet.addModule(rnnoiseWorkletUrl);
  const node = new AudioWorkletNode(context, "shanghao-rnnoise", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 1,
  });

  const ready = new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("rnnoise_init_timeout"));
    }, RNNOISE_INIT_TIMEOUT_MS);

    node.port.onmessage = (event: MessageEvent<RnnoiseMessage>) => {
      const message = event.data;
      if (message.type === "ready") {
        window.clearTimeout(timeout);
        diagnostics.noiseProcessor = "rnnoise_active";
        resolve();
        return;
      }
      if (message.type === "failed") {
        window.clearTimeout(timeout);
        diagnostics.noiseProcessor = "browser_fallback";
        void enableBrowserNoiseSuppression(inputStream);
        reject(new Error(message.error || "rnnoise_init_failed"));
        return;
      }
      if (message.type === "diagnostics") {
        diagnostics.processorOverruns = message.processorOverruns ?? 0;
        diagnostics.averageProcessingMs = message.averageProcessingMs ?? 0;
        diagnostics.maxProcessingMs = message.maxProcessingMs ?? 0;
        return;
      }
      if (message.type === "overloaded") {
        diagnostics.noiseProcessor = "browser_fallback";
        diagnostics.processorOverruns = message.processorOverruns ?? 0;
        diagnostics.averageProcessingMs = message.averageProcessingMs ?? 0;
        diagnostics.maxProcessingMs = message.maxProcessingMs ?? 0;
        void enableBrowserNoiseSuppression(inputStream);
        announceBrowserFallback("processor_overloaded");
      }
    };
  });

  try {
    await ready;
    return {
      node,
      dispose: () => {
        node.port.postMessage({ type: "dispose" });
        node.disconnect();
      },
    };
  } catch (error) {
    node.port.postMessage({ type: "dispose" });
    node.disconnect();
    throw error;
  }
};

export const createProcessedMicrophoneStream = async (
  inputStream: MediaStream,
  settings: Pick<
    AppSettings,
    "micEqualizerGains" | "preferredSampleRate" | "lowCutFrequency" | "isNoiseSuppressionEnabled"
  >,
): Promise<ProcessedMicrophoneStream> => {
  const gains = normalizeEqualizerGains(settings.micEqualizerGains);
  const processorDiagnostics: ProcessedMicrophoneStream["processorDiagnostics"] = {
    noiseProcessor: settings.isNoiseSuppressionEnabled ? "browser_fallback" : "bypass",
    processorOverruns: 0,
    averageProcessingMs: 0,
    maxProcessingMs: 0,
  };

  if (
    gains.every((gain) => gain === 0) &&
    settings.lowCutFrequency === "off" &&
    !settings.isNoiseSuppressionEnabled
  ) {
    return {
      stream: inputStream,
      processorDiagnostics,
      dispose: () => inputStream.getTracks().forEach((track) => track.stop()),
    };
  }

  const context = new AudioContext({
    latencyHint: "interactive",
    sampleRate:
      settings.preferredSampleRate === "auto" ? undefined : Number(settings.preferredSampleRate),
  });
  await context.resume();
  const source = context.createMediaStreamSource(inputStream);
  const destination = context.createMediaStreamDestination();
  const filtered = connectMicrophoneEqualizer(context, source, gains, settings.lowCutFrequency);

  let output: AudioNode = filtered;
  let disposeProcessor: () => void = () => undefined;
  if (settings.isNoiseSuppressionEnabled) {
    try {
      const rnnoise = await createRnnoiseNode(context, inputStream, processorDiagnostics);
      filtered.connect(rnnoise.node);
      output = rnnoise.node;
      disposeProcessor = rnnoise.dispose;
    } catch {
      processorDiagnostics.noiseProcessor = "browser_fallback";
      await enableBrowserNoiseSuppression(inputStream);
      announceBrowserFallback("processor_unavailable");
    }
  }
  output.connect(destination);

  return {
    stream: destination.stream,
    processorDiagnostics,
    dispose: () => {
      disposeProcessor();
      inputStream.getTracks().forEach((track) => track.stop());
      destination.stream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => undefined);
    },
  };
};
