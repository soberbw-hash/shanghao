export const RECORDING_TARGET_LOUDNESS_DB = -16;
export const RECORDING_MAX_BOOST_DB = 6;
export const RECORDING_MAX_CUT_DB = -6;

const SPEECH_RMS_GATE = 0.008;
const SPEECH_PEAK_GATE = 0.015;

export interface RecordingLoudnessState {
  gainDb: number;
  speechFrames: number;
  speechEnergy: number;
  measuredSpeechDb?: number;
}

export interface RecordingLevelFrame {
  rms: number;
  peak: number;
}

export const createRecordingLoudnessState = (): RecordingLoudnessState => ({
  gainDb: 0,
  speechFrames: 0,
  speechEnergy: 0,
});

export const isRecordingSpeechFrame = ({ rms, peak }: RecordingLevelFrame): boolean =>
  Number.isFinite(rms) &&
  Number.isFinite(peak) &&
  rms >= SPEECH_RMS_GATE &&
  peak >= SPEECH_PEAK_GATE;

/**
 * Recording-only speech loudness learner. Silence never changes the learned level, cuts react
 * quickly, and boosts take several seconds so background noise cannot be pulled forward.
 */
export const advanceRecordingLoudness = (
  state: RecordingLoudnessState,
  frame: RecordingLevelFrame,
  enabled: boolean,
): RecordingLoudnessState => {
  if (!enabled) return { ...state, gainDb: 0 };
  if (!isRecordingSpeechFrame(frame)) return state;

  const frameEnergy = frame.rms * frame.rms;
  const speechFrames = state.speechFrames + 1;
  const learningRate = speechFrames <= 12 ? 1 / speechFrames : 0.035;
  const speechEnergy =
    speechFrames === 1
      ? frameEnergy
      : state.speechEnergy + (frameEnergy - state.speechEnergy) * learningRate;
  const measuredSpeechDb = 10 * Math.log10(Math.max(1e-9, speechEnergy));
  const desiredGainDb = Math.max(
    RECORDING_MAX_CUT_DB,
    Math.min(RECORDING_MAX_BOOST_DB, RECORDING_TARGET_LOUDNESS_DB - measuredSpeechDb),
  );
  const response = desiredGainDb < state.gainDb ? 0.42 : 0.028;
  const gainDb = state.gainDb + (desiredGainDb - state.gainDb) * response;

  return { gainDb, speechFrames, speechEnergy, measuredSpeechDb };
};

export const gainDbToLinear = (gainDb: number): number => 10 ** (gainDb / 20);
