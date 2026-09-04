export const FRIEND_LOUDNESS_TARGET_LUFS = -16;
export const FRIEND_LOUDNESS_MAX_BOOST_DB = 6;
export const FRIEND_LOUDNESS_MAX_CUT_DB = -6;

const SPEECH_GATE_RMS = 0.008;
const SPEECH_GATE_PEAK = 0.015;
const MINIMUM_SPEECH_OBSERVATION_MS = 900;
const SPEECH_ENERGY_WINDOW_MS = 3_500;
const PEAK_RELEASE_MS = 2_500;
const BOOST_LEARNING_MS = 5_500;
const CUT_LEARNING_MS = 2_800;
const MAX_BOOST_RATE_DB_PER_SECOND = 0.8;
const MAX_CUT_RATE_DB_PER_SECOND = 1.8;
const PEAK_HEADROOM = 10 ** (-1.5 / 20);
export const FRIEND_LOUDNESS_HANGOVER_MS = 1_600;

export interface LoudnessBalanceState {
  meanSquare: number;
  peakEnvelope: number;
  activeFrames: number;
  gain: number;
  learnedGain: number;
  lastVoiceAt: number;
  lastUpdatedAt: number;
  observedSpeechMs: number;
  gainDb: number;
  learnedGainDb: number;
  estimatedLufs?: number;
}

export const createLoudnessBalanceState = (): LoudnessBalanceState => ({
  meanSquare: 0,
  peakEnvelope: 0,
  activeFrames: 0,
  gain: 1,
  learnedGain: 1,
  lastVoiceAt: 0,
  lastUpdatedAt: 0,
  observedSpeechMs: 0,
  gainDb: 0,
  learnedGainDb: 0,
});

export const estimateApproximateLufs = (meanSquare: number): number =>
  meanSquare > 0 ? -0.691 + 10 * Math.log10(meanSquare) : Number.NEGATIVE_INFINITY;

const gainFromDecibels = (decibels: number): number => 10 ** (decibels / 20);
const decibelsFromGain = (gain: number): number => 20 * Math.log10(Math.max(1e-6, gain));

const smoothingForTimeConstant = (elapsedMs: number, timeConstantMs: number): number =>
  1 - Math.exp(-Math.max(0, elapsedMs) / Math.max(1, timeConstantMs));

/**
 * Learns one stable offset per remote speaker from active speech only. The applied gain is rate
 * limited in dB, retained across pauses, and peak-capped so neither sentence gaps nor background
 * noise can cause audible pumping.
 */
export const advanceLoudnessBalance = (
  state: LoudnessBalanceState,
  input: { rms: number; peak: number; now: number; enabled: boolean },
): LoudnessBalanceState => {
  if (!input.enabled) return createLoudnessBalanceState();
  const rms = Number.isFinite(input.rms) ? Math.max(0, input.rms) : 0;
  const peak = Number.isFinite(input.peak) ? Math.max(0, input.peak) : 0;
  const hasSpeech = rms >= SPEECH_GATE_RMS && peak >= SPEECH_GATE_PEAK;
  const elapsedMs =
    state.lastUpdatedAt > 0 ? Math.max(16, Math.min(250, input.now - state.lastUpdatedAt)) : 66;

  if (!hasSpeech) {
    // Hold the learned offset through sentence gaps. Returning to unity here made every new
    // sentence start at the wrong level and then audibly swell once speech was detected again.
    const holdPeak =
      state.lastVoiceAt > 0 && input.now - state.lastVoiceAt <= FRIEND_LOUDNESS_HANGOVER_MS;
    return {
      ...state,
      peakEnvelope: holdPeak
        ? state.peakEnvelope
        : state.peakEnvelope * Math.exp(-elapsedMs / Math.max(1, PEAK_RELEASE_MS)),
      lastUpdatedAt: input.now,
    };
  }

  const energySmoothing = smoothingForTimeConstant(elapsedMs, SPEECH_ENERGY_WINDOW_MS);
  const meanSquare =
    state.activeFrames === 0
      ? rms * rms
      : state.meanSquare + (rms * rms - state.meanSquare) * energySmoothing;
  const peakEnvelope = Math.max(
    peak,
    state.peakEnvelope * Math.exp(-elapsedMs / Math.max(1, PEAK_RELEASE_MS)),
  );
  const activeFrames = state.activeFrames + 1;
  const observedSpeechMs = state.observedSpeechMs + elapsedMs;
  const estimatedLufs = estimateApproximateLufs(meanSquare);
  if (observedSpeechMs < MINIMUM_SPEECH_OBSERVATION_MS) {
    return {
      ...state,
      meanSquare,
      peakEnvelope,
      activeFrames,
      observedSpeechMs,
      lastVoiceAt: input.now,
      lastUpdatedAt: input.now,
      estimatedLufs,
    };
  }

  const correctionDb = Math.max(
    FRIEND_LOUDNESS_MAX_CUT_DB,
    Math.min(FRIEND_LOUDNESS_MAX_BOOST_DB, FRIEND_LOUDNESS_TARGET_LUFS - estimatedLufs),
  );
  const peakSafeGain = peakEnvelope > 0 ? PEAK_HEADROOM / peakEnvelope : 1;
  const desiredGainDb = Math.max(
    FRIEND_LOUDNESS_MAX_CUT_DB,
    Math.min(FRIEND_LOUDNESS_MAX_BOOST_DB, correctionDb, decibelsFromGain(peakSafeGain)),
  );
  const learningTimeMs = desiredGainDb < state.learnedGainDb ? CUT_LEARNING_MS : BOOST_LEARNING_MS;
  const learnedGainDb =
    state.learnedGainDb +
    (desiredGainDb - state.learnedGainDb) * smoothingForTimeConstant(elapsedMs, learningTimeMs);
  const deltaDb = learnedGainDb - state.gainDb;
  const maximumStepDb =
    ((deltaDb < 0 ? MAX_CUT_RATE_DB_PER_SECOND : MAX_BOOST_RATE_DB_PER_SECOND) * elapsedMs) / 1_000;
  const gainDb = state.gainDb + Math.max(-maximumStepDb, Math.min(maximumStepDb, deltaDb));
  const gain = gainFromDecibels(gainDb);
  const learnedGain = gainFromDecibels(learnedGainDb);
  return {
    meanSquare,
    peakEnvelope,
    activeFrames,
    observedSpeechMs,
    gain,
    learnedGain,
    gainDb,
    learnedGainDb,
    lastVoiceAt: input.now,
    lastUpdatedAt: input.now,
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
