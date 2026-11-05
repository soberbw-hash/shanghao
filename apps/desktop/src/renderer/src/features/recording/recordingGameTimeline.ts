import type { RecordingGameTimeline } from "@private-voice/shared";

type Member = { id: string; userId?: string; isEmptySlot?: boolean; gameName?: string };
const EVENT_LIMIT = 2000;

/** Event-driven snapshots: no timer, audio tap, network request, or historical inference. */
export function createRecordingGameTimeline(roomId: string, startedAt: number) {
  const states = new Map<string, string | undefined>();
  const events: RecordingGameTimeline["events"] = [];
  let complete = true;
  let lastOffset = 0;
  let finished: RecordingGameTimeline | undefined;
  const offsetAt = (now: number) => Math.max(lastOffset, Math.max(0, Math.round(now - startedAt)));
  const append = (event: RecordingGameTimeline["events"][number]) => {
    if (events.length >= EVENT_LIMIT) {
      complete = false;
      return;
    }
    events.push(event);
  };
  return {
    capture(currentRoomId: string, members: readonly Member[], now: number) {
      if (finished) return;
      if (currentRoomId !== roomId) {
        complete = false;
        return;
      }
      const offsetMs = offsetAt(now);
      lastOffset = offsetMs;
      const next = new Map<string, string | undefined>();
      for (const member of members) {
        if (member.isEmptySlot) continue;
        const id = (member.userId || member.id).trim();
        if (!id || id.length > 180 || next.has(id)) {
          complete = false;
          continue;
        }
        const game = member.gameName?.trim() || undefined;
        if (game && game.length > 80) {
          complete = false;
          continue;
        }
        next.set(id, game);
        if (!states.has(id) || states.get(id) !== game)
          append({ offsetMs, memberId: id, present: true, ...(game ? { gameName: game } : {}) });
      }
      for (const id of states.keys())
        if (!next.has(id)) append({ offsetMs, memberId: id, present: false });
      states.clear();
      for (const [id, game] of next) states.set(id, game);
    },
    finish(now: number): RecordingGameTimeline {
      if (!finished)
        finished = {
          schemaVersion: 1,
          roomId,
          durationMs: offsetAt(now),
          complete,
          events: [...events],
        };
      return finished;
    },
  };
}
