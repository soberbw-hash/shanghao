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
import {
  advanceSpeechProtection,
  approachSuppressionLevel,
  createSpeechProtectionState,
} from "./speechProtection";
import {
  advanceVoiceProcessingState,
  createVoiceProcessingState,
  targetsForVoiceProcessingMode,
} from "./voiceProcessingState";

export const MICROPHONE_EQ_FREQUENCIES = [80, 250, 1_000, 4_000, 12_000] as const;

export interface ProcessedMicrophoneStream {
  stream: MediaStream;
  processorDiagnostics: Pick<
    LocalAudioDiagnostics,
    | "noiseProcessor"
    | "speechProtection"
    | "voiceActivity"
    | "processingMode"
    | "doubleTalkDetected"
    | "remoteEchoDetected"
    | "speechProbability"
    | "remoteReferenceLevel"
    | "currentSuppressionLevel"
    | "rawProcessedMix"
    | "processorOverruns"
    | "averageProcessingMs"
    | "maxProcessingMs"
  >;
  ready: Promise<ProcessedMicrophoneStream["processorDiagnostics"]>;
  onDiagnostics: (
    listener: (diagnostics: ProcessedMicrophoneStream["processorDiagnostics"]) => void,
  ) => () => void;
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
export const DEEPFILTER_BASE_SUPPRESSION_LEVEL = 34;
export const DEEPFILTER_SPEECH_SUPPRESSION_LEVEL = 24;
export const SPEECH_RAW_MIX = 0.12;
export const SPEECH_PROCESSED_MIX = 0.88;
const DEEPFILTER_RAW_ALIGNMENT_SECONDS = 0.01;
const PROCESSOR_CROSSFADE_SECONDS = 0.06;
const SPEECH_MIX_ATTACK_SECONDS = 0.035;
const SPEECH_MIX_RELEASE_SECONDS = 0.22;

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
    noiseReductionLevel: DEEPFILTER_BASE_SUPPRESSION_LEVEL,
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
    core.setSuppressionLevel(DEEPFILTER_BASE_SUPPRESSION_LEVEL);
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

const connectMicrophoneLowCut = (
  context: AudioContext,
  source: AudioNode,
  lowCutFrequency: LowCutFrequency,
): AudioNode => {
  let currentNode = source;
  if (lowCutFrequency === "off") return currentNode;
  FOURTH_ORDER_BUTTERWORTH_Q.forEach((quality) => {
    const lowCut = context.createBiquadFilter();
    lowCut.type = "highpass";
    lowCut.frequency.setValueAtTime(Number(lowCutFrequency), context.currentTime);
    lowCut.Q.setValueAtTime(quality, context.currentTime);
    currentNode.connect(lowCut);
    currentNode = lowCut;
  });
  return currentNode;
};

interface NaturalVoiceEnhancer {
  output: AudioNode;
  presence?: BiquadFilterNode;
  airRestraint?: BiquadFilterNode;
  compressor?: DynamicsCompressorNode;
}

const connectNaturalVoiceEnhancer = (
  context: AudioContext,
  source: AudioNode,
  enabled: boolean,
): NaturalVoiceEnhancer => {
  if (!enabled) return { output: source };
  const presence = context.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 2_400;
  presence.Q.value = 0.75;
  presence.gain.value = 0.45;
  const airRestraint = context.createBiquadFilter();
  airRestraint.type = "highshelf";
  airRestraint.frequency.value = 6_500;
  airRestraint.gain.value = -0.8;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.knee.value = 10;
  compressor.ratio.value = 1.6;
  compressor.attack.value = 0.012;
  compressor.release.value = 0.18;
  source.connect(presence);
  presence.connect(airRestraint);
  airRestraint.connect(compressor);
  return { output: compressor, presence, airRestraint, compressor };
};

export const createProcessedMicrophoneStream = async (
  inputStream: MediaStream,
  settings: Pick<
    AppSettings,
    | "micEqualizerGains"
    | "lowCutFrequency"
    | "isNoiseSuppressionEnabled"
    | "isVoiceEnhancementEnabled"
  > & { microphoneSendVolume?: number; getRemoteReferenceLevel?: () => number },
): Promise<ProcessedMicrophoneStream> => {
  const userGains = normalizeEqualizerGains(settings.micEqualizerGains);
  const processorDiagnostics: ProcessedMicrophoneStream["processorDiagnostics"] = {
    noiseProcessor: settings.isNoiseSuppressionEnabled ? "deepfilter_loading" : "bypass",
    speechProtection: "inactive",
    voiceActivity: "inactive",
    processingMode: "noise",
    doubleTalkDetected: false,
    remoteEchoDetected: false,
    speechProbability: 0,
    remoteReferenceLevel: 0,
    currentSuppressionLevel: settings.isNoiseSuppressionEnabled
      ? DEEPFILTER_BASE_SUPPRESSION_LEVEL
      : undefined,
    rawProcessedMix: settings.isNoiseSuppressionEnabled
      ? { raw: 0, processed: 1 }
      : { raw: 1, processed: 0 },
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
  const filtered = connectMicrophoneLowCut(context, source, settings.lowCutFrequency);
  const blendBus = context.createGain();
  const naturalEnhancer = connectNaturalVoiceEnhancer(
    context,
    blendBus,
    settings.isVoiceEnhancementEnabled,
  );
  const equalized = connectMicrophoneEqualizer(context, naturalEnhancer.output, userGains, "off");
  equalized.connect(outputGain);
  const rawGain = context.createGain();
  rawGain.gain.value = 1;
  const rawDelay = settings.isNoiseSuppressionEnabled ? context.createDelay(0.05) : undefined;
  if (rawDelay) {
    rawDelay.delayTime.value = DEEPFILTER_RAW_ALIGNMENT_SECONDS;
    filtered.connect(rawDelay);
    rawDelay.connect(rawGain);
  } else {
    filtered.connect(rawGain);
  }
  rawGain.connect(blendBus);

  let disposed = false;
  let activeProcessor: DeepFilterNodeResult | undefined;
  let processedGain: GainNode | undefined;
  let protectionAnalyser: AnalyserNode | undefined;
  let protectionSilentGain: GainNode | undefined;
  let protectionFrameId = 0;
  let protectionState = createSpeechProtectionState();
  let voiceProcessingState = createVoiceProcessingState();
  let previousMicRms = 0;
  let previousProcessingMode = voiceProcessingState.mode;
  const micLevelHistory: number[] = [];
  const remoteLevelHistory: number[] = [];
  let currentSuppressionLevel = DEEPFILTER_BASE_SUPPRESSION_LEVEL;
  let lastAppliedSuppressionLevel = DEEPFILTER_BASE_SUPPRESSION_LEVEL;
  const diagnosticsListeners = new Set<
    (diagnostics: ProcessedMicrophoneStream["processorDiagnostics"]) => void
  >();
  const publishDiagnostics = () => {
    const snapshot = { ...processorDiagnostics };
    for (const listener of diagnosticsListeners) listener(snapshot);
  };
  const setMix = (protectingSpeech: boolean, immediate = false, rawTargetOverride?: number) => {
    if (!processedGain) return;
    const now = context.currentTime;
    const timeConstant = immediate
      ? 0.008
      : protectingSpeech
        ? SPEECH_MIX_ATTACK_SECONDS
        : SPEECH_MIX_RELEASE_SECONDS;
    const rawTarget = rawTargetOverride ?? (protectingSpeech ? SPEECH_RAW_MIX : 0);
    const processedTarget = Math.max(0, 1 - rawTarget);
    rawGain.gain.cancelScheduledValues(now);
    processedGain.gain.cancelScheduledValues(now);
    rawGain.gain.setTargetAtTime(rawTarget, now, timeConstant);
    processedGain.gain.setTargetAtTime(processedTarget, now, timeConstant);
    processorDiagnostics.rawProcessedMix = { raw: rawTarget, processed: processedTarget };
  };
  const fallbackToRaw = (reason: string) => {
    if (disposed || processorDiagnostics.noiseProcessor === "deepfilter_unavailable") return;
    processorDiagnostics.noiseProcessor = "deepfilter_unavailable";
    processorDiagnostics.speechProtection = "inactive";
    processorDiagnostics.currentSuppressionLevel = undefined;
    processorDiagnostics.rawProcessedMix = { raw: 1, processed: 0 };
    if (processedGain) crossfade(context, processedGain, rawGain);
    publishDiagnostics();
    resolveReady?.({ ...processorDiagnostics });
    resolveReady = undefined;
    announceDeepFilterUnavailable(reason);
  };
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
        gain.connect(blendBus);
        activeProcessor = processor;
        processedGain = gain;
        processorDiagnostics.noiseProcessor = "deepfilter_active";
        processorDiagnostics.speechProtection = protectionState.active ? "active" : "inactive";
        currentSuppressionLevel = protectionState.active
          ? DEEPFILTER_SPEECH_SUPPRESSION_LEVEL
          : DEEPFILTER_BASE_SUPPRESSION_LEVEL;
        lastAppliedSuppressionLevel = Math.round(currentSuppressionLevel);
        processor.core.setSuppressionLevel(lastAppliedSuppressionLevel);
        if (protectionState.active) {
          setMix(true, true);
        } else {
          crossfade(context, rawGain, gain);
          processorDiagnostics.rawProcessedMix = { raw: 0, processed: 1 };
        }
        processorDiagnostics.currentSuppressionLevel = lastAppliedSuppressionLevel;
        publishDiagnostics();
        resolveReady?.({ ...processorDiagnostics });
        resolveReady = undefined;

        processor.node.onprocessorerror = () => {
          fallbackToRaw("processor_runtime_error");
        };
      })
      .catch((error) => {
        if (disposed) return;
        fallbackToRaw(error instanceof Error ? error.message : "processor_initialization_failed");
      });

    protectionAnalyser = context.createAnalyser();
    protectionAnalyser.fftSize = 512;
    protectionAnalyser.smoothingTimeConstant = 0;
    protectionSilentGain = context.createGain();
    protectionSilentGain.gain.value = 0;
    filtered.connect(protectionAnalyser);
    protectionAnalyser.connect(protectionSilentGain);
    protectionSilentGain.connect(outputGain);
    const samples = new Float32Array(protectionAnalyser.fftSize);
    const updateProtection = () => {
      if (disposed || !protectionAnalyser) return;
      protectionAnalyser.getFloatTimeDomainData(samples);
      let squareTotal = 0;
      for (const sample of samples) squareTotal += sample * sample;
      const rms = Math.sqrt(squareTotal / Math.max(1, samples.length));
      let zeroCrossings = 0;
      for (let index = 1; index < samples.length; index += 1) {
        if ((samples[index - 1] ?? 0) * (samples[index] ?? 0) < 0) zeroCrossings += 1;
      }
      const zeroCrossingRate = zeroCrossings / samples.length;
      const continuity = Math.min(1, rms / Math.max(0.002, Math.abs(rms - previousMicRms) * 4));
      const speechProbability = Math.max(
        0,
        Math.min(
          1,
          (rms - protectionState.noiseFloor * 1.45) * 36 +
            continuity * 0.34 +
            (zeroCrossingRate > 0.02 && zeroCrossingRate < 0.28 ? 0.28 : 0),
        ),
      );
      const remoteLevel = Math.max(0, settings.getRemoteReferenceLevel?.() ?? 0);
      micLevelHistory.push(rms);
      remoteLevelHistory.push(remoteLevel);
      if (micLevelHistory.length > 14) micLevelHistory.shift();
      if (remoteLevelHistory.length > 14) remoteLevelHistory.shift();
      const micMean =
        micLevelHistory.reduce((sum, value) => sum + value, 0) / micLevelHistory.length;
      const remoteMean =
        remoteLevelHistory.reduce((sum, value) => sum + value, 0) / remoteLevelHistory.length;
      let covariance = 0;
      let micVariance = 0;
      let remoteVariance = 0;
      for (let index = 0; index < micLevelHistory.length; index += 1) {
        const micDelta = (micLevelHistory[index] ?? 0) - micMean;
        const remoteDelta = (remoteLevelHistory[index] ?? 0) - remoteMean;
        covariance += micDelta * remoteDelta;
        micVariance += micDelta * micDelta;
        remoteVariance += remoteDelta * remoteDelta;
      }
      const echoCorrelation =
        remoteLevel > 0.002 && micLevelHistory.length >= 6
          ? Math.max(
              0,
              Math.min(1, covariance / Math.sqrt(Math.max(1e-9, micVariance * remoteVariance))),
            )
          : 0;
      previousMicRms = rms;
      voiceProcessingState = advanceVoiceProcessingState(voiceProcessingState, {
        micRms: rms,
        speechProbability,
        remoteLevel,
        echoCorrelation,
        now: performance.now(),
      });
      const targets = targetsForVoiceProcessingMode(voiceProcessingState.mode);
      processorDiagnostics.voiceActivity = speechProbability >= 0.58 ? "active" : "inactive";
      processorDiagnostics.processingMode = voiceProcessingState.mode;
      processorDiagnostics.doubleTalkDetected = voiceProcessingState.mode === "double_talk";
      processorDiagnostics.remoteEchoDetected = voiceProcessingState.mode === "echo";
      processorDiagnostics.speechProbability = speechProbability;
      processorDiagnostics.remoteReferenceLevel = remoteLevel;
      if (naturalEnhancer.presence && naturalEnhancer.airRestraint) {
        const now = context.currentTime;
        const nearVoice = speechProbability >= 0.58;
        naturalEnhancer.presence.gain.setTargetAtTime(nearVoice ? 0.7 : 0.2, now, 0.08);
        naturalEnhancer.airRestraint.gain.setTargetAtTime(
          voiceProcessingState.mode === "echo" ? -1.4 : nearVoice ? -0.45 : -0.9,
          now,
          0.1,
        );
      }
      const previousActive = protectionState.active;
      protectionState = advanceSpeechProtection(protectionState, rms, performance.now());

      const processingModeChanged = previousProcessingMode !== voiceProcessingState.mode;
      previousProcessingMode = voiceProcessingState.mode;
      if (previousActive !== protectionState.active || processingModeChanged) {
        processorDiagnostics.speechProtection = protectionState.active ? "active" : "inactive";
        const protectsNearVoice =
          protectionState.active ||
          voiceProcessingState.mode === "near_speech" ||
          voiceProcessingState.mode === "double_talk";
        setMix(protectsNearVoice, false, targets.rawMix);
        publishDiagnostics();
      }

      const targetSuppression = targets.suppression;
      currentSuppressionLevel = approachSuppressionLevel(
        currentSuppressionLevel,
        targetSuppression,
        protectionState.active,
      );
      const nextSuppressionLevel = Math.round(currentSuppressionLevel);
      if (activeProcessor && nextSuppressionLevel !== lastAppliedSuppressionLevel) {
        try {
          activeProcessor.core.setSuppressionLevel(nextSuppressionLevel);
          lastAppliedSuppressionLevel = nextSuppressionLevel;
          processorDiagnostics.currentSuppressionLevel = nextSuppressionLevel;
          publishDiagnostics();
        } catch {
          fallbackToRaw("suppression_update_failed");
        }
      }
      protectionFrameId = window.requestAnimationFrame(updateProtection);
    };
    updateProtection();
  } else {
    resolveReady?.({ ...processorDiagnostics });
    resolveReady = undefined;
  }

  return {
    stream: destination.stream,
    processorDiagnostics,
    ready,
    onDiagnostics: (listener) => {
      diagnosticsListeners.add(listener);
      listener({ ...processorDiagnostics });
      return () => diagnosticsListeners.delete(listener);
    },
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
      diagnosticsListeners.clear();
      window.cancelAnimationFrame(protectionFrameId);
      if (activeProcessor) {
        activeProcessor.node.onprocessorerror = null;
        activeProcessor.node.disconnect();
        activeProcessor.core.destroy();
      }
      processedGain?.disconnect();
      protectionAnalyser?.disconnect();
      protectionSilentGain?.disconnect();
      rawDelay?.disconnect();
      rawGain.disconnect();
      blendBus.disconnect();
      naturalEnhancer.presence?.disconnect();
      naturalEnhancer.airRestraint?.disconnect();
      naturalEnhancer.compressor?.disconnect();
      outputGain.disconnect();
      outputLimiter.disconnect();
      inputStream.getTracks().forEach((track) => track.stop());
      destination.stream.getTracks().forEach((track) => track.stop());
      void context.close().catch(() => undefined);
    },
  };
};
