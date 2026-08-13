export interface SpeechProtectionState {
  active: boolean;
  noiseFloor: number;
  holdUntil: number;
}

export const SPEECH_PROTECTION_HANGOVER_MS = 480;

export const createSpeechProtectionState = (): SpeechProtectionState => ({
  active: false,
  noiseFloor: 0.004,
  holdUntil: 0,
});

export const advanceSpeechProtection = (
  previous: SpeechProtectionState,
  rmsLevel: number,
  now: number,
): SpeechProtectionState => {
  const level = Number.isFinite(rmsLevel) ? Math.max(0, Math.min(1, rmsLevel)) : 0;
  let noiseFloor = previous.noiseFloor;
  const learningCeiling = Math.max(0.025, noiseFloor * 3.2);
  if (!previous.active && level < learningCeiling) {
    noiseFloor += (level - noiseFloor) * 0.018;
  }

  const openThreshold = Math.max(0.007, Math.min(0.06, noiseFloor * 2.4 + 0.003));
  const closeThreshold = Math.max(0.0045, openThreshold * 0.55);
  const voiceDetected = previous.active ? level >= closeThreshold : level >= openThreshold;
  const holdUntil = voiceDetected ? now + SPEECH_PROTECTION_HANGOVER_MS : previous.holdUntil;
  const active = voiceDetected || now < holdUntil;

  return { active, noiseFloor, holdUntil };
};

export const approachSuppressionLevel = (
  current: number,
  target: number,
  protectingSpeech: boolean,
): number => {
  const smoothing = protectingSpeech ? 0.68 : 0.12;
  const next = current + (target - current) * smoothing;
  return Math.abs(target - next) < 0.15 ? target : next;
};
