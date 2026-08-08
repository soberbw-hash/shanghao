import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";

import type { RoomCollectionItem } from "@private-voice/shared";

interface PersistedRoomCollection {
  version: 1;
  rooms: Record<string, RoomCollectionItem[]>;
}

const EMPTY_COLLECTION: PersistedRoomCollection = { version: 1, rooms: {} };

const isStoredItem = (value: unknown): value is RoomCollectionItem => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<RoomCollectionItem>;
  return (
    typeof item.id === "string" &&
    item.id.length <= 128 &&
    ["text", "link", "image", "game"].includes(String(item.kind)) &&
    typeof item.title === "string" &&
    item.title.trim().length > 0 &&
    item.title.length <= 80 &&
    typeof item.content === "string" &&
    item.content.trim().length > 0 &&
    item.content.length <= 2_000 &&
    typeof item.createdByPeerId === "string" &&
    item.createdByPeerId.length <= 128 &&
    typeof item.createdByNickname === "string" &&
    item.createdByNickname.length <= 32 &&
    typeof item.createdAt === "string" &&
    Number.isFinite(Date.parse(item.createdAt))
  );
};

const parseCollection = (text: string): PersistedRoomCollection => {
  const parsed = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
  if (!parsed || typeof parsed !== "object" || !("rooms" in parsed)) {
    throw new Error("invalid_room_collection");
  }
  const rooms = (parsed as { rooms?: unknown }).rooms;
  if (!rooms || typeof rooms !== "object" || Array.isArray(rooms)) {
    throw new Error("invalid_room_collection_rooms");
  }
  return {
    version: 1,
    rooms: Object.fromEntries(
      Object.entries(rooms as Record<string, unknown>)
        .filter(([roomId, items]) => roomId.length <= 64 && Array.isArray(items))
        .map(([roomId, items]) => [
          roomId,
          (items as unknown[])
            .filter(isStoredItem)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
        ]),
    ),
  };
};

export class RoomCollectionStore {
  private collection: PersistedRoomCollection = structuredClone(EMPTY_COLLECTION);
  private writeQueue = Promise.resolve();

  private constructor(
    private readonly filePath?: string,
    private readonly log?: (message: string, context?: Record<string, unknown>) => void,
  ) {}

  static async create(
    filePath?: string,
    log?: (message: string, context?: Record<string, unknown>) => void,
  ): Promise<RoomCollectionStore> {
    const store = new RoomCollectionStore(filePath?.trim() || undefined, log);
    await store.load();
    return store;
  }

  get(roomId: string): RoomCollectionItem[] {
    return [...(this.collection.rooms[roomId] ?? [])].sort((left, right) =>
      left.createdAt.localeCompare(right.createdAt),
    );
  }

  add(roomId: string, item: RoomCollectionItem): void {
    this.collection.rooms[roomId] = [...this.get(roomId), item];
    this.queueWrite();
  }

  remove(roomId: string, itemId: string): void {
    this.collection.rooms[roomId] = this.get(roomId).filter((item) => item.id !== itemId);
    this.queueWrite();
  }

  async flush(): Promise<void> {
    await this.writeQueue;
  }

  private async load(): Promise<void> {
    if (!this.filePath) return;
    const backupPath = this.getBackupPath();
    for (const candidate of [this.filePath, backupPath]) {
      try {
        this.collection = parseCollection(await readFile(candidate, "utf8"));
        this.log?.("room collection loaded", {
          source: candidate === this.filePath ? "primary" : "backup",
        });
        return;
      } catch (error) {
        this.log?.("room collection candidate unavailable", {
          source: candidate === this.filePath ? "primary" : "backup",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private queueWrite(): void {
    if (!this.filePath) return;
    const snapshot = JSON.stringify(this.collection, null, 2);
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        const directory = dirname(this.filePath!);
        const temporaryPath = `${this.filePath}.tmp`;
        await mkdir(directory, { recursive: true });
        await copyFile(this.filePath!, this.getBackupPath()).catch(() => undefined);
        await unlink(temporaryPath).catch(() => undefined);
        await writeFile(temporaryPath, snapshot, { encoding: "utf8", flag: "wx" });
        await rename(temporaryPath, this.filePath!);
      })
      .catch((error) => {
        this.log?.("room collection write failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private getBackupPath(): string {
    const parsed = parse(this.filePath!);
    return join(parsed.dir, `${parsed.name}.backup${parsed.ext || ".json"}`);
  }
}
