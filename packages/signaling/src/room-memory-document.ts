import {
  ROOM_MEMORY_AUTO_TEXT_LIMIT,
  roomAutomaticMemoryText,
  type RoomMemorySnapshot,
  type RoomMemoryEntry,
  type SaveRoomMemoryRequest,
} from "@private-voice/shared";

export const appendAutomaticMemoryFact = (memory: RoomMemorySnapshot, text: string): boolean => {
  const combined = [roomAutomaticMemoryText(memory), text.trim()].filter(Boolean).join("\n");
  if (combined.length > ROOM_MEMORY_AUTO_TEXT_LIMIT) return false;
  if (memory.automaticText !== undefined) memory.automaticText = combined;
  return true;
};

export const publicRoomMemory = ({
  roomId,
  revision,
  manualText,
  autoEnabled,
  automaticText,
  entries,
}: RoomMemorySnapshot): RoomMemorySnapshot =>
  structuredClone({
    roomId,
    revision,
    manualText,
    autoEnabled,
    ...(automaticText === undefined ? {} : { automaticText }),
    entries,
  });

/** Retain human document edits when older clients still submit individual evidence rows. */
export const saveAutomaticMemoryDocument = (
  memory: RoomMemorySnapshot,
  request: SaveRoomMemoryRequest,
  entries: RoomMemoryEntry[],
): RoomMemoryEntry[] => {
  if (request.automaticText !== undefined) {
    memory.automaticText = request.automaticText.trim();
    if (!memory.automaticText) return [];
  } else if (memory.automaticText !== undefined) {
    for (const old of memory.entries) {
      const next = entries.find((entry) => entry.id === old.id);
      if (next?.text !== old.text)
        memory.automaticText = memory.automaticText.replace(old.text, next?.text ?? "");
    }
    memory.automaticText = memory.automaticText.trim();
  }
  return entries;
};
