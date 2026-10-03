import type { RoomMemorySnapshot } from "@private-voice/shared";
import { mergeRoomMemoryText } from "./roomMemoryDraftText";
/** Three-way refresh preserves local changes without restoring untouched, obsolete fields. */
export const mergeRoomMemoryDraft = (
  base: RoomMemorySnapshot,
  draft: RoomMemorySnapshot,
  latest: RoomMemorySnapshot,
): RoomMemorySnapshot => {
  if (base.roomId !== draft.roomId || base.roomId !== latest.roomId)
    throw new Error("room_memory_conflict");
  const { manualText, automaticText } = mergeRoomMemoryText(base, draft, latest);
  return {
    ...latest,
    manualText,
    autoEnabled: draft.autoEnabled === base.autoEnabled ? latest.autoEnabled : draft.autoEnabled,
    automaticText,
    entries: latest.entries.flatMap((entry) => {
      const old = base.entries.find((item) => item.id === entry.id),
        edited = draft.entries.find((item) => item.id === entry.id);
      if (!edited) return old ? [] : [entry];
      return [{ ...entry, text: old && old.text !== edited.text ? edited.text : entry.text }];
    }),
  };
};
