import { useEffect, useRef } from "react";
import { RecordingState, type VoiceMemoryProcessRequest } from "@private-voice/shared";
import { useRoomStore } from "../store/roomStore";
import { useRecordingStore } from "../store/recordingStore";

/** Bounded fallback observations; participant audio tracks remain the primary speaker evidence. */
export const useRecordingSpeakingTimeline = () => {
  const timeline = useRef<NonNullable<VoiceMemoryProcessRequest["speakingTimeline"]>>([]);
  const members = useRoomStore((state) => state.room.members);
  const state = useRecordingStore((store) => store.status.state);
  const startedAt = useRecordingStore((store) => store.status.startedAt);
  const ownedStartedAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (state !== RecordingState.Recording || !startedAt) return;
    if (ownedStartedAt.current !== startedAt) {
      timeline.current = [];
      ownedStartedAt.current = startedAt;
    }
    const offsetMs = Math.max(0, Date.now() - startedAt);
    for (const member of members) {
      if (member.speakingState !== "speaking") continue;
      const previous = timeline.current.at(-1);
      if (previous?.memberId === member.id && offsetMs - previous.offsetMs < 240) continue;
      timeline.current.push({
        offsetMs,
        memberId: member.id,
        nickname: member.nickname,
        userId: member.userId,
        usernameSnapshot: member.username,
        displayNameSnapshot: member.displayName ?? member.nickname,
      });
    }
    if (timeline.current.length > 40_000)
      timeline.current.splice(0, timeline.current.length - 40_000);
  }, [startedAt, state, members]);
  return timeline;
};
