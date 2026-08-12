import type {
  AppSettings,
  DeepFilterAssets,
  LocalAudioDiagnostics,
  LowCutFrequency,
  MicEqualizerGains,
} from "@private-voice/shared";
import { MICROPHONE_PROCESSING_SAMPLE_RATE } from "@private-voice/shared";
import { DeepFilterNet3Core } from "deepfilternet3-noise-filter";

import { FOURTH_ORDER_BUTTERWORTH_Q } from "./filterMath";

export const MICROPHONE_EQ_FREQUENCIES = [80, 250, 1_000, 4_000, 12_000] as const;
const VOICE_ENHANCEMENT_EQ_GAINS: MicEqualizerGains = [-2, -1, 0, 2, 1];

export interface ProcessedMicrophoneStream {
  stream: MediaStream;
  processorDiagnostics: Pick<
    LocalAudioDiagnostics,
    "noiseProcessor" | "processorOverruns" | "averageProcessingMs" | "maxProcessingMs"
  >;
  ready: Promise<ProcessedMicrophoneStream["processorDiagnostics"]>;
  setSendVolume: (volume: number) => void;
  getSendVolume: () => number;
  dispose: () => void;
}

interface DeepFilterAssetLoader {
  getAssetUrls: () => {
    wasm: string;
    model: string;
  };
  fetchAsset: (url: string) => Promise<ArrayBuffer>;
}

interface DeepFilterCoreInternals {
  assetLoader: DeepFilterAssetLoader;
}

interface DeepFilterNodeResult {
  core: DeepFilterNet3Core;
  node: AudioWorkletNode;
}

const DEEPFILTER_SAMPLE_RATE = MICROPHONE_PROCESSING_SAMPLE_RATE;
const DEEPFILTER_SUPPRESSION_LEVEL = 50;
const PROCESSOR_CROSSFADE_SECONDS = 0.06;

let deepFilterAssetsPromise: Promise<DeepFilterAssets> | undefined;

const loadDeepFilterAssets = (): Promise<DeepFilterAssets> => {
  deepFilterAssetsPromise ??= window.desktopApi.audio.getDeepFilterAssets().catch((error) => {
    deepFilterAssetsPromise = undefined;
    throw error;
  });
  return deepFilterAssetsPromise;
};

export const prewarmDeepFilterAssets = async (): Promise<void> => {
  const assets = await loadDeepFilterAssets();
  if (assets.wasm.byteLength === 0 || assets.model.byteLength === 0) {
    deepFilterAssetsPromise = undefined;
    throw new Error("deepfilter_assets_empty");
  }
};

const announceDeepFilterUnavailable = (reason: string): void => {
  window.dispatchEvent(new CustomEvent("shanghao:deepfilter-unavailable", { detail: { reason } }));
};

const crossfade = (context: AudioContext, from: GainNode, to: GainNode): void => {
  const now = context.currentTime;
  from.gain.cancelScheduledValues(now);
  to.gain.cancelScheduledValues(now);
  from.gain.setValueAtTime(from.gain.value, now);
  to.gain.setValueAtTime(to.gain.value, now);
  from.gain.linearRampToValueAtTime(0, now + PROCESSOR_CROSSFADE_SECONDS);
  to.gain.linearRampToValueAtTime(1, now + PROCESSOR_CROSSFADE_SECONDS);
};

const createDeepFilterNode = async (context: AudioContext): Promise<DeepFilterNodeResult> => {
  if (!context.audioWorklet) {
    throw new Error("audio_worklet_unavailable");
  }

  const core = new DeepFilterNet3Core({
    sampleRate: DEEPFILTER_SAMPLE_RATE,
    noiseReductionLevel: DEEPFILTER_SUPPRESSION_LEVEL,
    assetConfig: { cdnUrl: "shanghao://deepfilter" },
  });
  const loader: DeepFilterAssetLoader = {
    getAssetUrls: () => ({
      wasm: "shanghao://deepfilter/df_bg.wasm",
      model: "shanghao://deepfilter/DeepFilterNet3_onnx.tar.gz",
    }),
    fetchAsset: async (url) => {
      const assets = await loadDeepFilterAssets();
      return url.endsWith(".wasm") ? assets.wasm : assets.model;
    },
  };
  (core as unknown as DeepFilterCoreInternals).assetLoader = loader;

  try {
    await core.initialize();
    const node = await core.createAudioWorkletNode(context);
    core.setNoiseSuppressionEnabled(true);
    core.setSuppressionLevel(DEEPFILTER_SUPPRESSION_LEVEL);
    return { core, node };
  } catch (error) {
    core.destroy();
    throw error;
  }
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

export const createProcessedMicrophoneStream = async (
  inputStream: MediaStream,
  settings: Pick<
    AppSettings,
    | "micEqualizerGains"
    | "lowCutFrequency"
    | "isNoiseSuppressionEnabled"
    | "isVoiceEnhancementEnabled"
  > & { microphoneSendVolume?: number },
): Promise<ProcessedMicrophoneStream> => {
  const userGains = normalizeEqualizerGains(settings.micEqualizerGains);
  const gains = normalizeEqualizerGains(
    userGains.map((gain, index) =>
      settings.isVoiceEnhancementEnabled ? gain + (VOICE_ENHANCEMENT_EQ_GAINS[index] ?? 0) : gain,
    ),
  );
  const processorDiagnostics: ProcessedMicrophoneStream["processorDiagnostics"] = {
    noiseProcessor: settings.isNoiseSuppressionEnabled ? "deepfilter_loading" : "bypass",
    processorOverruns: 0,
    averageProcessingMs: 0,
    maxProcessingMs: 0,
  };
  const sendVolume = Math.max(0.5, Math.min(1.5, settings.microphoneSendVolume ?? 1));

  const context = new AudioContext({
    latencyHint: "interactive",
    sampleRate: DEEPFILTER_SAMPLE_RATE,
  });
  await context.resume();

  const source = context.createMediaStreamSource(inputStream);
  const destination = context.createMediaStreamDestination();
  const outputGain = context.createGain();
  const outputLimiter = context.createDynamicsCompressor();
  outputGain.gain.value = sendVolume;
  outputLimiter.threshold.value = -3;
  outputLimiter.knee.value = 4;
  outputLimiter.ratio.value = 12;
  outputLimiter.attack.value = 0.003;
  outputLimiter.release.value = 0.12;
  outputGain.connect(outputLimiter);
  outputLimiter.connect(destination);
  const filtered = connectMicrophoneEqualizer(context, source, gains, settings.lowCutFrequency);
  const rawGain = context.createGain();
  rawGain.gain.value = 1;
  filtered.connect(rawGain);
  rawGain.connect(outputGain);

  let disposed = false;
  let activeProcessor: DeepFilterNodeResult | undefined;
  let processedGain: GainNode | undefined;
  let resolveReady:
    ((diagnostics: ProcessedMicrophoneStream["processorDiagnostics"]) => void) | undefined;
  const ready = new Promise<ProcessedMicrophoneStream["processorDiagnostics"]>((resolve) => {
    resolveReady = resolve;
  });

  if (settings.isNoiseSuppressionEnabled) {
    void createDeepFilterNode(context)
      .then((processor) => {
        if (disposed) {
          processor.core.destroy();
          return;
        }

        const gain = context.createGain();
        gain.gain.value = 0;
        filtered.connect(processor.node);
        processor.node.connect(gain);
        gain.connect(outputGain);
        activeProcessor = processor;
        processedGain = gain;
        processorDiagnostics.noiseProcessor = "deepfilter_active";
        crossfade(context, rawGain, gain);
        resolveReady?.({ ...processorDiagnostics });
        resolveReady = undefined;

        processor.node.onprocessorerror = () => {
          if (disposed || processorDiagnostics.noiseProcessor === "deepfilter_unavailable") {
            return;
          }
          processorDiagnostics.noiseProcessor = "deepfilter_unavailable";
          crossfade(context, gain, rawGain);
          resolveReady?.({ ...processorDiagnostics });
          resolveReady = undefined;
          announceDeepFilterUnavailable("processor_runtime_error");
        };
      })
      .catch((error) => {
        if (disposed) return;
        processorDiagnostics.noiseProcessor = "deepfilter_unavailable";
        resolveReady?.({ ...processorDiagnostics });
        resolveReady = undefined;
        announceDeepFilterUnavailable(
          error instanceof Error ? error.message : "processor_initialization_failed",
        );
      });
  } else {
    resolveReady?.({ ...processorDiagnostics });
    resolveReady = undefined;
  }

  return {
    stream: destination.stream,
    processorDiagnostics,
    ready,
    setSendVolume: (volume) => {
      if (disposed) return;
      const normalized = Math.max(0.5, Math.min(1.5, Number.isFinite(volume) ? volume : 1));
      const now = context.currentTime;
      outputGain.gain.cancelScheduledValues(now);
      outputGain.gain.setTargetAtTime(normalized, now, 0.018);
    },
    getSendVolume: () => outputGain.gain.value,
    dispose: () => {
      disposed = true;
      resolveReady?.({ ...processorDiagnostics });
      resolveReady = undefined;
      if (activeProcessor) {
        activeProcessor.node.onprocessorerror = null;
        activeProcessor.node.disconnect();
        activeProcessor.core.destroy();
      }
      processedGain?.disconnect();
      rawGain.disconnect();
      outputGain.disconnect();
      outputLimiter.disconnect();
      inputStream.getTracks().forEach((track) => track.stop());
      destination.stream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => undefined);
    },
  };
};
