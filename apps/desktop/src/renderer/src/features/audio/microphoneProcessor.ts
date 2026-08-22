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
import { SPEECH_PROTECTION_HANGOVER_MS } from "./speechProtection";

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
const PROTECTION_WORKLET_NAME = "shanghao-microphone-protection";
const PROTECTION_ANALYSIS_FRAMES = 512;
const PROTECTION_DIAGNOSTICS_INTERVAL_MS = 250;

/**
 * The protection path is deliberately an AudioWorklet.  It owns the audio
 * clock, VAD/echo evidence and raw/processed crossfade so visual rendering
 * cannot delay AEC-adjacent protection decisions.  The main thread receives
 * low-rate diagnostics and only forwards DeepFilter level changes.
 */
const PROTECTION_WORKLET_SOURCE = `
class ShangHaoMicrophoneProtection extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rawMix = 1;
    this.processedMix = 0;
    this.rawTarget = 1;
    this.processedTarget = 0;
    this.rawTimeConstant = 0.22;
    this.processedTimeConstant = 0.22;
    this.remoteLevel = 0;
    this.previousRms = 0;
    this.noiseFloor = 0.004;
    this.protectionActive = false;
    this.holdUntil = 0;
    this.mode = "noise";
    this.candidate = "noise";
    this.candidateSince = 0;
    this.modeHoldUntil = 0;
    this.previousSuppression = 34;
    this.frames = 0;
    this.micHistory = [];
    this.remoteHistory = [];
    this.overruns = 0;
    this.processingTotalMs = 0;
    this.processingSamples = 0;
    this.maxProcessingMs = 0;
    this.port.onmessage = (event) => {
      const message = event.data;
      if (!message) return;
      if (message.type === "remote-level") {
        this.remoteLevel = Number.isFinite(message.level) ? Math.max(0, message.level) : 0;
      } else if (message.type === "mix") {
        this.rawTarget = Math.max(0, Math.min(1, message.raw));
        this.processedTarget = Math.max(0, Math.min(1, message.processed));
        this.rawTimeConstant = Math.max(0.008, message.timeConstant || 0.22);
        this.processedTimeConstant = this.rawTimeConstant;
      }
    };
  }

  smooth(current, target, timeConstant) {
    const coefficient = 1 - Math.exp(-128 / (sampleRate * Math.max(0.008, timeConstant)));
    return current + (target - current) * coefficient;
  }

  classify(micRms, speechProbability, remoteLevel, echoCorrelation, now) {
    const remoteActive = remoteLevel >= 0.018;
    const nearSpeech = speechProbability >= 0.58 && micRms >= 0.006;
    const echoLikely = remoteActive && echoCorrelation >= 0.48;
    const candidate = nearSpeech && remoteActive
      ? "double_talk"
      : nearSpeech
        ? "near_speech"
        : echoLikely || remoteActive
          ? "echo"
          : "noise";
    const candidateSince = candidate === this.candidate ? this.candidateSince : now;
    const attackMs = candidate === "double_talk" || candidate === "near_speech" ? 35 : 110;
    const canSwitch = candidate === this.mode || now - candidateSince >= attackMs;
    const nextMode = canSwitch ? candidate : this.mode;
    const holdUntil = nextMode === "double_talk" || nextMode === "near_speech"
      ? Math.max(this.modeHoldUntil, now + 360)
      : this.modeHoldUntil;
    this.candidate = candidate;
    this.candidateSince = candidateSince;
    if (now >= this.modeHoldUntil || nextMode === "double_talk" || nextMode === "near_speech") {
      this.mode = nextMode;
      this.modeHoldUntil = holdUntil;
    }
    return this.mode;
  }

  process(inputs, outputs) {
    const startedAt = globalThis.performance?.now?.() ?? 0;
    const raw = inputs[0]?.[0];
    const processed = inputs[1]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    let squareTotal = 0;
    let zeroCrossings = 0;
    for (let index = 0; index < output.length; index += 1) {
      this.rawMix = this.smooth(this.rawMix, this.rawTarget, this.rawTimeConstant);
      this.processedMix = this.smooth(this.processedMix, this.processedTarget, this.processedTimeConstant);
      const rawSample = raw?.[index] ?? 0;
      const processedSample = processed?.[index] ?? 0;
      const sample = rawSample * this.rawMix + processedSample * this.processedMix;
      output[index] = sample;
      // Preserve the established protection input: measure filtered microphone
      // audio, not the already mixed DeepFilter output.
      squareTotal += rawSample * rawSample;
      if (index > 0) {
        const previous = raw?.[index - 1] ?? 0;
        if (previous * rawSample < 0) zeroCrossings += 1;
      }
    }
    this.frames += output.length;
    if (this.frames >= ${PROTECTION_ANALYSIS_FRAMES}) {
      this.frames = 0;
      const rms = Math.sqrt(squareTotal / Math.max(1, output.length));
      const zeroCrossingRate = zeroCrossings / Math.max(1, output.length);
      const continuity = Math.min(1, rms / Math.max(0.002, Math.abs(rms - this.previousRms) * 4));
      const speechProbability = Math.max(0, Math.min(1,
        (rms - this.noiseFloor * 1.45) * 36
          + continuity * 0.34
          + (zeroCrossingRate > 0.02 && zeroCrossingRate < 0.28 ? 0.28 : 0)
      ));
      const now = currentTime * 1000;
      if (!this.protectionActive && rms < Math.max(0.025, this.noiseFloor * 3.2)) {
        this.noiseFloor += (rms - this.noiseFloor) * 0.018;
      }
      const openThreshold = Math.max(0.007, Math.min(0.06, this.noiseFloor * 2.4 + 0.003));
      const closeThreshold = Math.max(0.0045, openThreshold * 0.55);
      const voiceDetected = this.protectionActive ? rms >= closeThreshold : rms >= openThreshold;
      if (voiceDetected) this.holdUntil = now + ${SPEECH_PROTECTION_HANGOVER_MS};
      this.protectionActive = voiceDetected || now < this.holdUntil;
      this.micHistory.push(rms);
      this.remoteHistory.push(this.remoteLevel);
      if (this.micHistory.length > 14) this.micHistory.shift();
      if (this.remoteHistory.length > 14) this.remoteHistory.shift();
      let micMean = 0;
      let remoteMean = 0;
      for (let index = 0; index < this.micHistory.length; index += 1) {
        micMean += this.micHistory[index] ?? 0;
        remoteMean += this.remoteHistory[index] ?? 0;
      }
      micMean /= Math.max(1, this.micHistory.length);
      remoteMean /= Math.max(1, this.remoteHistory.length);
      let covariance = 0;
      let micVariance = 0;
      let remoteVariance = 0;
      for (let index = 0; index < this.micHistory.length; index += 1) {
        const micDelta = (this.micHistory[index] ?? 0) - micMean;
        const remoteDelta = (this.remoteHistory[index] ?? 0) - remoteMean;
        covariance += micDelta * remoteDelta;
        micVariance += micDelta * micDelta;
        remoteVariance += remoteDelta * remoteDelta;
      }
      const echoCorrelation = this.remoteLevel > 0.002 && this.micHistory.length >= 6
        ? Math.max(0, Math.min(1, covariance / Math.sqrt(Math.max(1e-9, micVariance * remoteVariance))))
        : 0;
      const mode = this.classify(rms, speechProbability, this.remoteLevel, echoCorrelation, now);
      const targetSuppression = mode === "near_speech" || mode === "double_talk" ? 24 : 34;
      const rawTarget = mode === "near_speech" ? 0.12 : mode === "double_talk" ? 0.16 : 0;
      const suppressionSmoothing = this.protectionActive ? 0.68 : 0.12;
      this.previousSuppression += (targetSuppression - this.previousSuppression) * suppressionSmoothing;
      const processingMs = (globalThis.performance?.now?.() ?? startedAt) - startedAt;
      const deadlineMs = output.length * 1000 / sampleRate;
      if (processingMs > deadlineMs) this.overruns += 1;
      this.processingTotalMs += processingMs;
      this.processingSamples += 1;
      this.maxProcessingMs = Math.max(this.maxProcessingMs, processingMs);
      this.previousRms = rms;
      this.port.postMessage({
        type: "analysis",
        rms,
        speechProbability,
        remoteLevel: this.remoteLevel,
        echoCorrelation,
        mode,
        protectionActive: this.protectionActive,
        rawMix: this.rawMix,
        processedMix: this.processedMix,
        targetSuppression: Math.round(this.previousSuppression),
        processorOverruns: this.overruns,
        averageProcessingMs: this.processingTotalMs / Math.max(1, this.processingSamples),
        maxProcessingMs: this.maxProcessingMs,
      });
    }
    return true;
  }
}
registerProcessor("${PROTECTION_WORKLET_NAME}", ShangHaoMicrophoneProtection);
`;

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

const createProtectionWorkletNode = async (context: AudioContext): Promise<AudioWorkletNode> => {
  if (!context.audioWorklet) throw new Error("audio_worklet_unavailable");
  const moduleUrl = URL.createObjectURL(
    new Blob([PROTECTION_WORKLET_SOURCE], { type: "text/javascript" }),
  );
  try {
    await context.audioWorklet.addModule(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
  return new AudioWorkletNode(context, PROTECTION_WORKLET_NAME, {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
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
  lowCutFrequency: LowCutFrequency = "75",
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
  if (!settings.isNoiseSuppressionEnabled) rawGain.connect(blendBus);

  let disposed = false;
  let activeProcessor: DeepFilterNodeResult | undefined;
  let processedGain: GainNode | undefined;
  let protectionWorklet: AudioWorkletNode | undefined;
  let remoteReferenceTimer: number | undefined;
  let currentSuppressionLevel = DEEPFILTER_BASE_SUPPRESSION_LEVEL;
  let lastAppliedSuppressionLevel = DEEPFILTER_BASE_SUPPRESSION_LEVEL;
  let lastPublishedDiagnosticsAt = 0;
  const diagnosticsListeners = new Set<
    (diagnostics: ProcessedMicrophoneStream["processorDiagnostics"]) => void
  >();
  const publishDiagnostics = (force = false) => {
    const now = performance.now();
    if (!force && now - lastPublishedDiagnosticsAt < PROTECTION_DIAGNOSTICS_INTERVAL_MS) return;
    lastPublishedDiagnosticsAt = now;
    const snapshot = { ...processorDiagnostics };
    for (const listener of diagnosticsListeners) listener(snapshot);
  };
  const setMix = (protectingSpeech: boolean, immediate = false, rawTargetOverride?: number) => {
    const timeConstant = immediate
      ? 0.008
      : protectingSpeech
        ? SPEECH_MIX_ATTACK_SECONDS
        : SPEECH_MIX_RELEASE_SECONDS;
    const rawTarget = rawTargetOverride ?? (protectingSpeech ? SPEECH_RAW_MIX : 0);
    const processedTarget = Math.max(0, 1 - rawTarget);
    if (protectionWorklet) {
      protectionWorklet.port.postMessage({
        type: "mix",
        raw: rawTarget,
        processed: processedTarget,
        timeConstant,
      });
    } else if (processedGain) {
      const now = context.currentTime;
      rawGain.gain.cancelScheduledValues(now);
      processedGain.gain.cancelScheduledValues(now);
      rawGain.gain.setTargetAtTime(rawTarget, now, timeConstant);
      processedGain.gain.setTargetAtTime(processedTarget, now, timeConstant);
    }
    processorDiagnostics.rawProcessedMix = { raw: rawTarget, processed: processedTarget };
  };
  const fallbackToRaw = (reason: string) => {
    if (disposed || processorDiagnostics.noiseProcessor === "deepfilter_unavailable") return;
    processorDiagnostics.noiseProcessor = "deepfilter_unavailable";
    processorDiagnostics.speechProtection = "inactive";
    processorDiagnostics.currentSuppressionLevel = undefined;
    processorDiagnostics.rawProcessedMix = { raw: 1, processed: 0 };
    if (protectionWorklet) {
      protectionWorklet.port.postMessage({
        type: "mix",
        raw: 1,
        processed: 0,
        timeConstant: PROCESSOR_CROSSFADE_SECONDS,
      });
    } else if (processedGain) {
      crossfade(context, processedGain, rawGain);
    }
    publishDiagnostics(true);
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
    try {
      protectionWorklet = await createProtectionWorkletNode(context);
      rawGain.connect(protectionWorklet, 0, 0);
      protectionWorklet.connect(blendBus);
      protectionWorklet.port.postMessage({
        type: "mix",
        raw: 1,
        processed: 0,
        timeConstant: 0.008,
      });
      remoteReferenceTimer = window.setInterval(() => {
        if (disposed || !protectionWorklet) return;
        protectionWorklet.port.postMessage({
          type: "remote-level",
          level: Math.max(0, settings.getRemoteReferenceLevel?.() ?? 0),
        });
      }, 50);
      protectionWorklet.port.onmessage = (event: MessageEvent) => {
        if (disposed || event.data?.type !== "analysis") return;
        const analysis = event.data as {
          speechProbability: number;
          remoteLevel: number;
          echoCorrelation: number;
          mode: "noise" | "echo" | "near_speech" | "double_talk";
          protectionActive: boolean;
          rawMix: number;
          processedMix: number;
          targetSuppression: number;
          processorOverruns: number;
          averageProcessingMs: number;
          maxProcessingMs: number;
        };
        const modeChanged = processorDiagnostics.processingMode !== analysis.mode;
        const protectionChanged =
          processorDiagnostics.speechProtection !==
          (analysis.protectionActive ? "active" : "inactive");
        processorDiagnostics.voiceActivity =
          analysis.speechProbability >= 0.58 ? "active" : "inactive";
        processorDiagnostics.processingMode = analysis.mode;
        processorDiagnostics.doubleTalkDetected = analysis.mode === "double_talk";
        processorDiagnostics.remoteEchoDetected = analysis.mode === "echo";
        processorDiagnostics.speechProbability = analysis.speechProbability;
        processorDiagnostics.remoteReferenceLevel = analysis.remoteLevel;
        processorDiagnostics.speechProtection = analysis.protectionActive ? "active" : "inactive";
        processorDiagnostics.rawProcessedMix = {
          raw: analysis.rawMix,
          processed: analysis.processedMix,
        };
        processorDiagnostics.processorOverruns = analysis.processorOverruns;
        processorDiagnostics.averageProcessingMs = analysis.averageProcessingMs;
        processorDiagnostics.maxProcessingMs = analysis.maxProcessingMs;
        currentSuppressionLevel = analysis.targetSuppression;
        if (naturalEnhancer.presence && naturalEnhancer.airRestraint) {
          const now = context.currentTime;
          const nearVoice = analysis.speechProbability >= 0.58;
          naturalEnhancer.presence.gain.setTargetAtTime(nearVoice ? 0.7 : 0.2, now, 0.08);
          naturalEnhancer.airRestraint.gain.setTargetAtTime(
            analysis.mode === "echo" ? -1.4 : nearVoice ? -0.45 : -0.9,
            now,
            0.1,
          );
        }
        if (activeProcessor && analysis.targetSuppression !== lastAppliedSuppressionLevel) {
          try {
            activeProcessor.core.setSuppressionLevel(analysis.targetSuppression);
            lastAppliedSuppressionLevel = analysis.targetSuppression;
            processorDiagnostics.currentSuppressionLevel = analysis.targetSuppression;
          } catch {
            fallbackToRaw("suppression_update_failed");
            return;
          }
        }
        publishDiagnostics(modeChanged || protectionChanged);
      };
    } catch {
      // Chromium/Electron versions without AudioWorklet keep the established
      // direct graph; the DeepFilter failure path still preserves raw audio.
      protectionWorklet = undefined;
      rawGain.connect(blendBus);
    }

    void createDeepFilterNode(context)
      .then((processor) => {
        if (disposed) {
          processor.core.destroy();
          return;
        }

        const gain = context.createGain();
        gain.gain.value = protectionWorklet ? 1 : 0;
        filtered.connect(processor.node);
        processor.node.connect(gain);
        if (protectionWorklet) gain.connect(protectionWorklet, 0, 1);
        else gain.connect(blendBus);
        activeProcessor = processor;
        processedGain = gain;
        processorDiagnostics.noiseProcessor = "deepfilter_active";
        currentSuppressionLevel = DEEPFILTER_BASE_SUPPRESSION_LEVEL;
        lastAppliedSuppressionLevel = Math.round(currentSuppressionLevel);
        processor.core.setSuppressionLevel(lastAppliedSuppressionLevel);
        setMix(false, true);
        processorDiagnostics.currentSuppressionLevel = lastAppliedSuppressionLevel;
        publishDiagnostics(true);
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
      if (remoteReferenceTimer !== undefined) window.clearInterval(remoteReferenceTimer);
      remoteReferenceTimer = undefined;
      if (activeProcessor) {
        activeProcessor.node.onprocessorerror = null;
        activeProcessor.node.disconnect();
        activeProcessor.core.destroy();
      }
      processedGain?.disconnect();
      protectionWorklet?.disconnect();
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
