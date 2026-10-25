const mixedTracks = new WeakMap<MediaStreamTrack, Set<MediaStreamTrack>>();

/** All outgoing branches inherit the same microphone/PTT/phone privacy gate. */
export function setAudioSendEnabled(primary: MediaStreamTrack, enabled: boolean): void {
  primary.enabled = enabled;
  for (const track of mixedTracks.get(primary) ?? []) track.enabled = enabled;
}
export function linkAudioSendGate(primary: MediaStreamTrack, mixed: MediaStreamTrack): () => void {
  let tracks = mixedTracks.get(primary);
  if (!tracks) mixedTracks.set(primary, (tracks = new Set()));
  tracks.add(mixed);
  mixed.enabled = primary.enabled;
  return () => {
    tracks.delete(mixed);
    if (!tracks.size) mixedTracks.delete(primary);
  };
}
