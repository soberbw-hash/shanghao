export interface SpeakingDetectorControls {
  destroy: () => void;
}

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
  let frameId = 0;
  let previousState = false;
  let lastLevelPublishedAt = 0;
  let smoothedLevel = 0;
  let noiseFloor = 0.008;
  let speakingHoldUntil = 0;

  const tick = (): void => {
    analyser.getByteFrequencyData(data);
    const average = data.reduce((sum, value) => sum + value, 0) / Math.max(data.length, 1);
    const normalizedLevel = average / 255;
    const visualLevel = Math.min(1, normalizedLevel * 6);
    const smoothing = visualLevel > smoothedLevel ? 0.48 : 0.12;
    smoothedLevel += (visualLevel - smoothedLevel) * smoothing;
    const now = performance.now();
    if (!previousState && normalizedLevel < Math.max(0.08, noiseFloor * 3.5)) {
      noiseFloor += (normalizedLevel - noiseFloor) * 0.018;
    }
    const openThreshold = Math.max(0.012, Math.min(0.14, noiseFloor * 2.8 + 0.006));
    const closeThreshold = Math.max(0.009, openThreshold * 0.62);
    if (normalizedLevel >= openThreshold) {
      speakingHoldUntil = now + 180;
    }
    const isSpeaking = previousState
      ? normalizedLevel >= closeThreshold || now < speakingHoldUntil
      : normalizedLevel >= openThreshold;

    if (isSpeaking !== previousState) {
      previousState = isSpeaking;
      onSpeakingChange(isSpeaking, normalizedLevel);
    }
    if (onLevel && now - lastLevelPublishedAt >= 66) {
      lastLevelPublishedAt = now;
      onLevel(smoothedLevel < 0.01 ? 0 : smoothedLevel);
    }

    frameId = window.requestAnimationFrame(tick);
  };

  tick();

  return {
    destroy: () => {
      window.cancelAnimationFrame(frameId);
      source.disconnect();
      analyser.disconnect();
      void audioContext.close();
    },
  };
};
