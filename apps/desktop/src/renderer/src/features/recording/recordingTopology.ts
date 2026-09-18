import type { RoomMember } from "@private-voice/shared";

export interface RecordingTopologyInput {
  room: { roomId?: string; members: RoomMember[] };
  localStream?: MediaStream;
  remoteStreams: Record<string, MediaStream>;
}

/** Compare recording inputs, never UI speaking/latency/seat properties. */
export const createRecordingTopologyGuard = () => {
  let previous: unknown[] | undefined;
  return (state: RecordingTopologyInput): boolean => {
    const next: unknown[] = [state.room.roomId, state.localStream];
    const appendStream = (stream: MediaStream | undefined) => {
      const tracks = stream?.getAudioTracks() ?? [];
      next.push(stream, tracks.length);
      for (const track of tracks) next.push(track, track.id, track.enabled, track.readyState);
    };
    appendStream(state.localStream);
    for (const id of Object.keys(state.remoteStreams).sort()) {
      next.push(id);
      appendStream(state.remoteStreams[id]);
    }
    next.push("identities");
    for (const member of state.room.members) {
      if (member.isEmptySlot) continue;
      next.push(
        member.id,
        member.isLocal,
        member.userId,
        member.nickname,
        member.avatarId,
        member.joinedAt,
      );
    }
    const changed =
      !previous ||
      previous.length !== next.length ||
      next.some((value, index) => value !== previous![index]);
    if (changed) previous = next;
    return changed;
  };
};
