export type VoiceProcessingMode = "noise" | "echo" | "near_speech" | "double_talk";

export interface VoiceProcessingFeatures {
  micRms: number;
  speechProbability: number;
  remoteLevel: number;
  echoCorrelation: number;
  now: number;
}

export interface VoiceProcessingState {
  mode: VoiceProcessingMode;
  candidate: VoiceProcessingMode;
  candidateSince: number;
  holdUntil: number;
}

export interface VoiceProcessingTargets {
  suppression: number;
  rawMix: number;
}

export const createVoiceProcessingState = (): VoiceProcessingState => ({
  mode: "noise",
  candidate: "noise",
  candidateSince: 0,
  holdUntil: 0,
});

const classify = (features: VoiceProcessingFeatures): VoiceProcessingMode => {
  const remoteActive = features.remoteLevel >= 0.018;
  const nearSpeech = features.speechProbability >= 0.58 && features.micRms >= 0.006;
  const echoLikely = remoteActive && features.echoCorrelation >= 0.48;
  if (nearSpeech && remoteActive) return "double_talk";
  if (nearSpeech) return "near_speech";
  if (echoLikely || remoteActive) return "echo";
  return "noise";
};

/** Smooths VAD, far-end activity and echo evidence into one non-flapping processing mode. */
export const advanceVoiceProcessingState = (
  previous: VoiceProcessingState,
  features: VoiceProcessingFeatures,
): VoiceProcessingState => {
  const candidate = classify(features);
  const candidateSince = candidate === previous.candidate ? previous.candidateSince : features.now;
  const attackMs = candidate === "double_talk" || candidate === "near_speech" ? 35 : 110;
  const canSwitch = candidate === previous.mode || features.now - candidateSince >= attackMs;
  const mode = canSwitch ? candidate : previous.mode;
  const holdUntil =
    mode === "double_talk" || mode === "near_speech"
      ? Math.max(previous.holdUntil, features.now + 360)
      : previous.holdUntil;
  if (features.now < previous.holdUntil && mode !== "double_talk" && mode !== "near_speech") {
    return { mode: previous.mode, candidate, candidateSince, holdUntil: previous.holdUntil };
  }
  return { mode, candidate, candidateSince, holdUntil };
};

export const targetsForVoiceProcessingMode = (
  mode: VoiceProcessingMode,
): VoiceProcessingTargets => {
  switch (mode) {
    case "double_talk":
      return { suppression: 24, rawMix: 0.16 };
    case "near_speech":
      return { suppression: 24, rawMix: 0.12 };
    case "echo":
      return { suppression: 34, rawMix: 0 };
    default:
      return { suppression: 34, rawMix: 0 };
  }
};
