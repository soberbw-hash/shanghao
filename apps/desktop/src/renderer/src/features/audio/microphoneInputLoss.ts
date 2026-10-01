export const MICROPHONE_INPUT_LOST = "shanghao:microphone-input-lost";

/** A processor output can stay live after its USB input dies. Forward that loss. */
export const forwardMicrophoneInputLoss = (
  input: MediaStream,
  output: MediaStream,
  isDisposed: () => boolean,
): (() => void) => {
  const tracks = input.getAudioTracks();
  const ended = () => {
    if (!isDisposed() && tracks.every((track) => track.readyState === "ended")) {
      window.dispatchEvent(new CustomEvent(MICROPHONE_INPUT_LOST, { detail: output }));
    }
  };
  tracks.forEach((track) => track.addEventListener("ended", ended));
  return () => tracks.forEach((track) => track.removeEventListener("ended", ended));
};
