export interface SpeakingDetectorControls {
  destroy: () => void;
}

export interface SpeakingActivityState {
  isSpeaking: boolean;
  noiseFloor: number;
  holdUntil: number;
}

const SPEAKING_ANALYSIS_INTERVAL_MS = 33;

export const createSpeakingActivityState = (): SpeakingActivityState => ({
  isSpeaking: false,
  noiseFloor: 0.008,
  holdUntil: 0,
});

export const advanceSpeakingActivity = (
  previous: SpeakingActivityState,
  normalizedLevel: number,
  now: number,
): SpeakingActivityState => {
  let noiseFloor = previous.noiseFloor;
  if (normalizedLevel < Math.max(0.08, noiseFloor * 3.5)) {
    // A steady fan or virtual-device floor may initially cross the open threshold.
    // Keep learning it slowly while active so the UI cannot remain green forever.
    const smoothing = previous.isSpeaking ? 0.004 : 0.018;
    noiseFloor += (normalizedLevel - noiseFloor) * smoothing;
  }
  const openThreshold = Math.max(0.012, Math.min(0.14, noiseFloor * 2.8 + 0.006));
  const closeThreshold = Math.max(0.009, openThreshold * 0.62);
  const holdUntil = normalizedLevel >= openThreshold ? now + 180 : previous.holdUntil;
  const isSpeaking = previous.isSpeaking
    ? normalizedLevel >= closeThreshold || now < holdUntil
    : normalizedLevel >= openThreshold;
  return { isSpeaking, noiseFloor, holdUntil };
};

export const createSpeakingDetector = (
  stream: MediaStream,
  onSpeakingChange: (isSpeaking: boolean, level: number) => void,
  onLevel?: (level: number) => void,
): SpeakingDetectorControls => {
  const audioContext = new AudioContext({ latencyHint: "interactive" });
  void audioContext.resume().catch(() => undefined);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;

  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let timerId = 0;
  let activityState = createSpeakingActivityState();
  let lastLevelPublishedAt = 0;
  let smoothedLevel = 0;

  const tick = (): void => {
    analyser.getByteFrequencyData(data);
    const average = data.reduce((sum, value) => sum + value, 0) / Math.max(data.length, 1);
    const normalizedLevel = average / 255;
    const visualLevel = Math.min(1, normalizedLevel * 6);
    const smoothing = visualLevel > smoothedLevel ? 0.48 : 0.12;
    smoothedLevel += (visualLevel - smoothedLevel) * smoothing;
    const now = performance.now();
    const nextActivityState = advanceSpeakingActivity(activityState, normalizedLevel, now);
    const isSpeaking = nextActivityState.isSpeaking;

    if (isSpeaking !== activityState.isSpeaking) {
      onSpeakingChange(isSpeaking, normalizedLevel);
    }
    activityState = nextActivityState;
    if (onLevel && now - lastLevelPublishedAt >= 66) {
      lastLevelPublishedAt = now;
      onLevel(smoothedLevel < 0.01 ? 0 : smoothedLevel);
    }
  };

  tick();
  // Voice activity does not need to follow a 120/144/160 Hz display. Keeping it
  // on a fixed 30 Hz cadence avoids spending a renderer frame on audio analysis
  // while preserving sub-50 ms speaking feedback.
  timerId = window.setInterval(tick, SPEAKING_ANALYSIS_INTERVAL_MS);

  return {
    destroy: () => {
      window.clearInterval(timerId);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close();
    },
  };
};
