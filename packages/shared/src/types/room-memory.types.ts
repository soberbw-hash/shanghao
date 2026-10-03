import { isPrivateRoomId } from "./private-room.types";

export const ROOM_MEMORY_TEXT_LIMIT = 4_000;
export const ROOM_MEMORY_ENTRY_LIMIT = 32;
export const ROOM_MEMORY_FACT_LIMIT = 240;
export const ROOM_MEMORY_AUTO_TEXT_LIMIT = 8_000;
/** Legacy report browsing stays compatible; private room AI context requires the current room. */
export const isRoomAiScopeAllowed = (source: string, target: string): boolean =>
  source === target || (!isPrivateRoomId(source) && !isPrivateRoomId(target));
export interface RoomMemoryEntry {
  id: string;
  text: string;
  quote: string;
  sourceId: string;
  sourceTitle: string;
  updatedAt: string;
}
export interface RoomMemorySnapshot {
  roomId: string;
  revision: number;
  manualText: string;
  autoEnabled: boolean;
  /** One editable document; legacy snapshots derive it from their evidence entries. */
  automaticText?: string;
  entries: RoomMemoryEntry[];
}
export interface SaveRoomMemoryRequest {
  roomId: string;
  revision: number;
  manualText: string;
  autoEnabled: boolean;
  automaticText?: string;
  entries: Array<Pick<RoomMemoryEntry, "id" | "text">>;
}
export interface RoomMemoryApi {
  get: (roomId: string) => Promise<RoomMemorySnapshot>;
  save: (request: SaveRoomMemoryRequest) => Promise<RoomMemorySnapshot>;
}
const bounded = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
export const isRoomMemorySnapshot = (value: unknown): value is RoomMemorySnapshot => {
  if (!value || typeof value !== "object") return false;
  const memory = value as RoomMemorySnapshot;
  return (
    isPrivateRoomId(memory.roomId) &&
    Number.isSafeInteger(memory.revision) &&
    memory.revision >= 0 &&
    bounded(memory.manualText, ROOM_MEMORY_TEXT_LIMIT) &&
    typeof memory.autoEnabled === "boolean" &&
    (memory.automaticText === undefined ||
      bounded(memory.automaticText, ROOM_MEMORY_AUTO_TEXT_LIMIT)) &&
    Array.isArray(memory.entries) &&
    memory.entries.length <= ROOM_MEMORY_ENTRY_LIMIT &&
    new Set(memory.entries.map((entry) => entry?.id)).size === memory.entries.length &&
    memory.entries.every(
      (entry) =>
        entry &&
        typeof entry.id === "string" &&
        /^[a-f0-9]{64}$/.test(entry.id) &&
        bounded(entry.text, ROOM_MEMORY_FACT_LIMIT) &&
        Boolean(entry.text.trim()) &&
        bounded(entry.quote, 300) &&
        bounded(entry.sourceId, 128) &&
        bounded(entry.sourceTitle, 120) &&
        typeof entry.updatedAt === "string" &&
        Number.isFinite(Date.parse(entry.updatedAt)),
    )
  );
};
export {
  roomAutomaticMemoryText,
  roomMemoryContext,
  isOptionalRoomMemoryText,
  verifySavedMemoryDocument,
} from "./room-memory-context";
