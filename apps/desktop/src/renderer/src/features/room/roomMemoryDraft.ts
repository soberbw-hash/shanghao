import { ROOM_MEMORY_TEXT_LIMIT, type RoomMemorySnapshot } from "@private-voice/shared";
/** Three-way refresh preserves local changes without restoring untouched, obsolete fields. */
export const mergeRoomMemoryDraft = (
  base: RoomMemorySnapshot,
  draft: RoomMemorySnapshot,
  latest: RoomMemorySnapshot,
): RoomMemorySnapshot => {
  if (base.roomId !== draft.roomId || base.roomId !== latest.roomId)
    throw new Error("room_memory_conflict");
  const orphanEdits = draft.entries.filter(
    (entry) =>
      base.entries.some((old) => old.id === entry.id && old.text !== entry.text) &&
      !latest.entries.some((current) => current.id === entry.id),
  );
  const manualText = [
    draft.manualText === base.manualText ? latest.manualText : draft.manualText,
    ...orphanEdits.map((entry) => entry.text),
  ]
    .filter(Boolean)
    .join("\n");
  if (manualText.length > ROOM_MEMORY_TEXT_LIMIT) throw new Error("room_memory_conflict");
  return {
    ...latest,
    manualText,
    autoEnabled: draft.autoEnabled === base.autoEnabled ? latest.autoEnabled : draft.autoEnabled,
    entries: latest.entries.flatMap((entry) => {
      const old = base.entries.find((item) => item.id === entry.id),
        edited = draft.entries.find((item) => item.id === entry.id);
      if (!edited) return old ? [] : [entry];
      return [{ ...entry, text: old && old.text !== edited.text ? edited.text : entry.text }];
    }),
  };
};
