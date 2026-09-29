import type { RemoteAudioMixInput } from "./RemoteAudioMixer";

export interface RemoteAudioSyncInput extends RemoteAudioMixInput {
  audioTrackId?: string;
  playable: boolean;
}

/** Speaking and latency updates do not require rebuilding the remote audio graph. */
export const sameRemoteAudioSyncInputs = (
  previous: readonly RemoteAudioSyncInput[],
  next: readonly RemoteAudioSyncInput[],
): boolean =>
  previous.length === next.length &&
  previous.every(
    (input, index) =>
      input.peerId === next[index]?.peerId &&
      input.stream === next[index]?.stream &&
      input.audioTrackId === next[index]?.audioTrackId &&
      input.playable === next[index]?.playable &&
      input.volume === next[index]?.volume,
  );
