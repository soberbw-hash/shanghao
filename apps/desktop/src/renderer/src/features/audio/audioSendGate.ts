const mixedTracks = new WeakMap<MediaStreamTrack, Set<MediaStreamTrack>>();
let holds = 0;

/** Close old and newly published branches throughout a device transaction. Release never opens them. */
export function holdAudioSend(primary?: MediaStreamTrack): () => void {
  holds++;
  if (primary) setAudioSendEnabled(primary, false);
  let released = false;
  return () => {
    if (!released) {
      released = true;
      holds--;
    }
  };
}

/** All outgoing branches inherit the same microphone/PTT/phone privacy gate. */
export function setAudioSendEnabled(primary: MediaStreamTrack, enabled: boolean): void {
  const allowed = enabled && holds === 0;
  primary.enabled = allowed;
  for (const track of mixedTracks.get(primary) ?? []) track.enabled = allowed;
}
export function linkAudioSendGate(primary: MediaStreamTrack, mixed: MediaStreamTrack): () => void {
  let tracks = mixedTracks.get(primary);
  if (!tracks) mixedTracks.set(primary, (tracks = new Set()));
  tracks.add(mixed);
  mixed.enabled = primary.enabled && holds === 0;
  return () => {
    tracks.delete(mixed);
    if (!tracks.size) mixedTracks.delete(primary);
  };
}
