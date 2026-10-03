import {
  ROOM_MEMORY_ENTRY_LIMIT,
  ROOM_MEMORY_FACT_LIMIT,
  ROOM_MEMORY_TEXT_LIMIT,
  isOptionalRoomMemoryText,
  type SaveRoomMemoryRequest,
} from "@private-voice/shared";
/** Reject malformed transport requests before attaching account credentials. */
export const validateRoomMemoryRequest = (request: SaveRoomMemoryRequest): void => {
  if (
    !request ||
    typeof request !== "object" ||
    !Number.isSafeInteger(request.revision) ||
    request.revision < 0 ||
    typeof request.manualText !== "string" ||
    request.manualText.length > ROOM_MEMORY_TEXT_LIMIT ||
    typeof request.autoEnabled !== "boolean" ||
    !isOptionalRoomMemoryText(request.automaticText) ||
    !Array.isArray(request.entries) ||
    request.entries.length > ROOM_MEMORY_ENTRY_LIMIT ||
    !request.entries.every(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        /^[a-f0-9]{64}$/.test(entry.id) &&
        typeof entry.text === "string" &&
        entry.text.trim() &&
        entry.text.length <= ROOM_MEMORY_FACT_LIMIT,
    )
  )
    throw new Error("room_memory_invalid");
};
