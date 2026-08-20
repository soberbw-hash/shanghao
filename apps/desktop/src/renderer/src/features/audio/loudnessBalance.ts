export const FRIEND_LOUDNESS_TARGET_LUFS = -14;
export const FRIEND_LOUDNESS_MAX_BOOST_DB = 8.5;
export const FRIEND_LOUDNESS_MAX_CUT_DB = -9;

const SPEECH_GATE_RMS = 0.008;
const SPEECH_GATE_PEAK = 0.015;
const MINIMUM_SPEECH_FRAMES = 8;
const PEAK_HEADROOM = 10 ** (-1 / 20);
export const FRIEND_LOUDNESS_HANGOVER_MS = 900;

export interface LoudnessBalanceState {
  meanSquare: number;
  peakEnvelope: number;
  activeFrames: number;
  gain: number;
  learnedGain: number;
  lastVoiceAt: number;
  estimatedLufs?: number;
}

export const createLoudnessBalanceState = (): LoudnessBalanceState => ({
  meanSquare: 0,
  peakEnvelope: 0,
  activeFrames: 0,
  gain: 1,
  learnedGain: 1,
  lastVoiceAt: 0,
});

export const estimateApproximateLufs = (meanSquare: number): number =>
  meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : Number.NEGATIVE_INFINITY;

const gainFromDecibels = (decibels: number): number => 10 ** (decibels / 20);

/**
 * Learns only from active speech. Quiet boosts are intentionally slower than loud cuts, and
 * measured peaks cap positive gain so one friend cannot be normalized into clipping.
 */
export const advanceLoudnessBalance = (
  state: LoudnessBalanceState,
  input: { rms: number; peak: number; now: number; enabled: boolean },
): LoudnessBalanceState => {
  if (!input.enabled) return createLoudnessBalanceState();
  const rms = Number.isFinite(input.rms) ? Math.max(0, input.rms) : 0;
  const peak = Number.isFinite(input.peak) ? Math.max(0, input.peak) : 0;
  const hasSpeech = rms >= SPEECH_GATE_RMS && peak >= SPEECH_GATE_PEAK;

  if (!hasSpeech) {
    if (!state.lastVoiceAt || input.now - state.lastVoiceAt < FRIEND_LOUDNESS_HANGOVER_MS) {
      return state;
    }
    return {
      ...state,
      peakEnvelope: state.peakEnvelope * 0.985,
      gain: state.gain + (1 - state.gain) * 0.12,
    };
  }

  const meanSquare =
    state.activeFrames === 0 ? rms * rms : state.meanSquare * 0.965 + rms * rms * 0.035;
  const peakEnvelope = Math.max(peak, state.peakEnvelope * 0.985);
  const activeFrames = state.activeFrames + 1;
  const estimatedLufs = estimateApproximateLufs(meanSquare);
  if (activeFrames < MINIMUM_SPEECH_FRAMES) {
    return {
      ...state,
      meanSquare,
      peakEnvelope,
      activeFrames,
      lastVoiceAt: input.now,
      estimatedLufs,
    };
  }

  const correctionDb = Math.max(
    FRIEND_LOUDNESS_MAX_CUT_DB,
    Math.min(FRIEND_LOUDNESS_MAX_BOOST_DB, FRIEND_LOUDNESS_TARGET_LUFS - estimatedLufs),
  );
  const peakSafeGain = peakEnvelope > 0 ? PEAK_HEADROOM / peakEnvelope : 1;
  const desiredGain = Math.max(
    gainFromDecibels(FRIEND_LOUDNESS_MAX_CUT_DB),
    Math.min(
      gainFromDecibels(FRIEND_LOUDNESS_MAX_BOOST_DB),
      peakSafeGain,
      gainFromDecibels(correctionDb),
    ),
  );
  const learnedGain = state.learnedGain + (desiredGain - state.learnedGain) * 0.08;
  const reopening =
    state.lastVoiceAt > 0 && input.now - state.lastVoiceAt > FRIEND_LOUDNESS_HANGOVER_MS;
  const smoothing = desiredGain < state.gain ? 0.22 : reopening ? 0.28 : 0.035;
  return {
    meanSquare,
    peakEnvelope,
    activeFrames,
    gain: state.gain + (learnedGain - state.gain) * smoothing,
    learnedGain,
    lastVoiceAt: input.now,
    estimatedLufs,
  };
};

export const applyLoudnessBalanceToMemberVolume = (
  memberVolume: number,
  balanceGain: number,
  enabled: boolean,
): number => {
  if (memberVolume <= 0) return 0;
  return Math.min(4, memberVolume * (enabled ? balanceGain : 1));
};
