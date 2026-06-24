export interface SpeakingDetectorControls {
  destroy: () => void;
}

export const createSpeakingDetector = (
  stream: MediaStream,
  onSpeakingChange: (isSpeaking: boolean, level: number) => void,
  inputThreshold = 0.4,
): SpeakingDetectorControls => {
  const audioContext = new AudioContext();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;

  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let frameId = 0;
  let previousState = false;

  const tick = (): void => {
    analyser.getByteFrequencyData(data);
    const average = data.reduce((sum, value) => sum + value, 0) / Math.max(data.length, 1);
    const normalizedLevel = average / 255;
    const isSpeaking = normalizedLevel > Math.max(0.01, Math.min(0.2, inputThreshold * 0.2));

    if (isSpeaking !== previousState) {
      previousState = isSpeaking;
      onSpeakingChange(isSpeaking, normalizedLevel);
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
