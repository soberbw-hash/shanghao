export const hasPlayableAudioTrack = (stream: MediaStream): boolean =>
  stream.getAudioTracks().some((track) => track.readyState === "live" && track.enabled);
