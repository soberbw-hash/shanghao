import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import {
  isPrivateRoomId,
  isRoomMemorySnapshot,
  ROOM_MEMORY_ENTRY_LIMIT,
  ROOM_MEMORY_FACT_LIMIT,
  ROOM_MEMORY_TEXT_LIMIT,
  type RoomMemorySnapshot,
  type SaveRoomMemoryRequest,
} from "@private-voice/shared";
import { VersionedJsonStore } from "./versioned-json-store";

interface StoredMemory extends RoomMemorySnapshot {
  rejected: string[];
  sources: string[];
}
interface MemoryData {
  version: 1;
  rooms: StoredMemory[];
}
export class RoomMemoryError extends Error {}
const MAX_MEMORY_BYTES = 16 * 1024 * 1024;
function invalid(): never {
  throw new RoomMemoryError("room_memory_invalid");
}
const fresh = (roomId: string): StoredMemory => ({
  roomId,
  revision: 0,
  manualText: "",
  autoEnabled: true,
  entries: [],
  rejected: [],
  sources: [],
});
const validate = (value: unknown): MemoryData => {
  const data = value as MemoryData;
  if (!data || data.version !== 1 || !Array.isArray(data.rooms) || data.rooms.length > 10_000)
    invalid();
  const ids = new Set<string>();
  for (const memory of data.rooms) {
    if (
      !isRoomMemorySnapshot(memory) ||
      ids.has(memory.roomId) ||
      !Array.isArray(memory.rejected) ||
      memory.rejected.length > 256 ||
      !memory.rejected.every((id) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id)) ||
      !Array.isArray(memory.sources) ||
      memory.sources.length > 256 ||
      !memory.sources.every((id) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id))
    )
      invalid();
    ids.add(memory.roomId);
  }
  return data;
};
const fingerprint = (value: string) =>
  createHash("sha256").update(value.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
const publicMemory = ({
  roomId,
  revision,
  manualText,
  autoEnabled,
  entries,
}: StoredMemory): RoomMemorySnapshot =>
  structuredClone({ roomId, revision, manualText, autoEnabled, entries });
/** Atomic per-room revisions; no automatic operation overwrites human text or corrections. */
export class RoomMemoryStore {
  private readonly memories: Map<string, StoredMemory>;
  private constructor(private readonly store: VersionedJsonStore<MemoryData>) {
    this.memories = new Map(store.snapshot().rooms.map((memory) => [memory.roomId, memory]));
  }
  static async open(file?: string) {
    if (file) {
      try {
        if ((await stat(file)).size > MAX_MEMORY_BYTES)
          throw new RoomMemoryError("room_memory_full");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return new RoomMemoryStore(
      await VersionedJsonStore.open(file, { version: 1, rooms: [] }, validate),
    );
  }
  get(roomId: string): RoomMemorySnapshot {
    if (!isPrivateRoomId(roomId)) invalid();
    return publicMemory(this.memories.get(roomId) ?? fresh(roomId));
  }
  save(request: SaveRoomMemoryRequest): Promise<RoomMemorySnapshot> {
    if (
      !request ||
      !isPrivateRoomId(request.roomId) ||
      !Number.isSafeInteger(request.revision) ||
      request.revision < 0 ||
      typeof request.manualText !== "string" ||
      request.manualText.length > ROOM_MEMORY_TEXT_LIMIT ||
      typeof request.autoEnabled !== "boolean" ||
      !Array.isArray(request.entries) ||
      request.entries.length > ROOM_MEMORY_ENTRY_LIMIT ||
      new Set(request.entries.map((entry) => entry?.id)).size !== request.entries.length
    )
      invalid();
    return this.store
      .transact((data) => {
        const memory = this.obtain(data, request.roomId);
        if (memory.revision !== request.revision) throw new RoomMemoryError("room_memory_conflict");
        const entries = request.entries.map((edit) => {
          const saved = memory.entries.find((entry) => entry.id === edit?.id);
          if (
            !saved ||
            typeof edit.text !== "string" ||
            !edit.text.trim() ||
            edit.text.length > ROOM_MEMORY_FACT_LIMIT
          )
            invalid();
          return {
            ...saved,
            text: edit.text.trim(),
            updatedAt: saved.text === edit.text.trim() ? saved.updatedAt : new Date().toISOString(),
          };
        });
        const removed = memory.entries
          .filter((entry) => !entries.some((saved) => entry.id === saved.id))
          .map((entry) => entry.id);
        memory.rejected = [...new Set([...memory.rejected, ...removed])].slice(-256);
        memory.entries = entries;
        memory.manualText = request.manualText.trim();
        memory.autoEnabled = request.autoEnabled;
        memory.revision++;
        return this.commitResult(data, memory);
      })
      .then((memory) => {
        this.memories.set(memory.roomId, memory);
        return publicMemory(memory);
      });
  }
  async add(
    roomId: string,
    revision: number,
    source: { id: string; title: string; text: string },
    facts: unknown,
  ): Promise<void> {
    if (
      !isPrivateRoomId(roomId) ||
      !Array.isArray(facts) ||
      !source ||
      typeof source.id !== "string" ||
      source.id.length > 128 ||
      typeof source.title !== "string" ||
      source.title.length > 120 ||
      typeof source.text !== "string" ||
      source.text.length > 12000
    )
      invalid();
    const sourceKey = fingerprint(`${source.id}|${source.text}`);
    const committed = await this.store.transact((data) => {
      const memory = this.obtain(data, roomId);
      if (!memory.autoEnabled || memory.revision !== revision || memory.sources.includes(sourceKey))
        return this.commitResult(data, memory);
      for (const value of facts.slice(0, 8)) {
        const fact = value as { text?: unknown; quote?: unknown };
        if (
          !fact ||
          typeof fact.text !== "string" ||
          !fact.text.trim() ||
          fact.text.length > ROOM_MEMORY_FACT_LIMIT ||
          typeof fact.quote !== "string" ||
          fact.quote.trim().length < 4 ||
          fact.quote.length > 300 ||
          !source.text.includes(fact.quote.trim())
        )
          continue;
        const id = fingerprint(fact.text);
        if (
          memory.entries.length >= ROOM_MEMORY_ENTRY_LIMIT ||
          memory.rejected.includes(id) ||
          memory.entries.some((entry) => entry.id === id)
        )
          continue;
        memory.entries.push({
          id,
          text: fact.text.trim(),
          quote: fact.quote.trim(),
          sourceId: source.id.slice(0, 128),
          sourceTitle: source.title.slice(0, 120),
          updatedAt: new Date().toISOString(),
        });
      }
      memory.sources = [...memory.sources, sourceKey].slice(-256);
      memory.revision++;
      return this.commitResult(data, memory);
    });
    this.memories.set(roomId, committed);
  }
  hasSource(roomId: string, source: { id: string; text: string }): boolean {
    return (
      this.memories.get(roomId)?.sources.includes(fingerprint(`${source.id}|${source.text}`)) ??
      false
    );
  }
  flush() {
    return this.store.flush();
  }
  private commitResult(data: MemoryData, memory: StoredMemory): StoredMemory {
    if (!Number.isSafeInteger(memory.revision)) invalid();
    if (Buffer.byteLength(JSON.stringify(data), "utf8") > MAX_MEMORY_BYTES)
      throw new RoomMemoryError("room_memory_full");
    return structuredClone(memory);
  }
  private obtain(data: MemoryData, roomId: string): StoredMemory {
    let memory = data.rooms.find((item) => item.roomId === roomId);
    if (!memory) {
      if (data.rooms.length >= 10_000) throw new RoomMemoryError("room_memory_full");
      memory = fresh(roomId);
      data.rooms.push(memory);
    }
    return memory;
  }
}
