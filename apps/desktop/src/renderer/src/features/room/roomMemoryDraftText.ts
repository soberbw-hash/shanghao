import {
  ROOM_MEMORY_AUTO_TEXT_LIMIT,
  ROOM_MEMORY_TEXT_LIMIT,
  roomAutomaticMemoryText,
  type RoomMemorySnapshot,
} from "@private-voice/shared";
export const mergeRoomMemoryText = (
  base: RoomMemorySnapshot,
  draft: RoomMemorySnapshot,
  latest: RoomMemorySnapshot,
) => {
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
  const autoEdited = roomAutomaticMemoryText(draft) !== roomAutomaticMemoryText(base);
  const automaticText = autoEdited
    ? [
        roomAutomaticMemoryText(draft),
        ...latest.entries
          .filter(
            (entry) =>
              !base.entries.some((old) => old.id === entry.id) &&
              !roomAutomaticMemoryText(draft).includes(entry.text),
          )
          .map((entry) => entry.text),
      ]
        .filter(Boolean)
        .join("\n")
    : latest.automaticText;
  if (
    manualText.length > ROOM_MEMORY_TEXT_LIMIT ||
    (automaticText && automaticText.length > ROOM_MEMORY_AUTO_TEXT_LIMIT)
  )
    throw new Error("room_memory_conflict");
  return { manualText, automaticText };
};
