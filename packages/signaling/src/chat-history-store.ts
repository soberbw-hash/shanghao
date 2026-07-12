import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";

import type { ServerChatMessage } from "./protocol";

interface PersistedChatHistory {
  version: 1;
  rooms: Record<string, ServerChatMessage[]>;
}

const EMPTY_HISTORY: PersistedChatHistory = { version: 1, rooms: {} };

const isStoredMessage = (value: unknown): value is ServerChatMessage => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const message = value as Partial<ServerChatMessage>;
  return (
    typeof message.id === "string" &&
    message.id.length <= 128 &&
    typeof message.peerId === "string" &&
    message.peerId.length <= 128 &&
    typeof message.nickname === "string" &&
    message.nickname.length <= 32 &&
    typeof message.content === "string" &&
    message.content.trim().length > 0 &&
    message.content.length <= 500 &&
    typeof message.createdAt === "string" &&
    Number.isFinite(Date.parse(message.createdAt))
  );
};

const parseHistory = (text: string): PersistedChatHistory => {
  const parsed = JSON.parse(text.replace(/^\uFEFF/, "")) as unknown;
  if (!parsed || typeof parsed !== "object" || !("rooms" in parsed)) {
    throw new Error("invalid_chat_history");
  }
  const rooms = (parsed as { rooms?: unknown }).rooms;
  if (!rooms || typeof rooms !== "object" || Array.isArray(rooms)) {
    throw new Error("invalid_chat_history_rooms");
  }
  const sanitizedRooms = Object.fromEntries(
    Object.entries(rooms as Record<string, unknown>)
      .filter(([roomId, messages]) => roomId.length <= 64 && Array.isArray(messages))
      .map(([roomId, messages]) => [
        roomId,
        (messages as unknown[])
          .filter(isStoredMessage)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .slice(-100),
      ]),
  );
  return { version: 1, rooms: sanitizedRooms };
};

export class ChatHistoryStore {
  private history: PersistedChatHistory = structuredClone(EMPTY_HISTORY);
  private writeQueue = Promise.resolve();

  private constructor(
    private readonly filePath?: string,
    private readonly log?: (message: string, context?: Record<string, unknown>) => void,
  ) {}

  static async create(
    filePath?: string,
    log?: (message: string, context?: Record<string, unknown>) => void,
  ): Promise<ChatHistoryStore> {
    const store = new ChatHistoryStore(filePath?.trim() || undefined, log);
    await store.load();
    return store;
  }

  get(roomId: string): ServerChatMessage[] {
    return [...(this.history.rooms[roomId] ?? [])]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-100);
  }

  append(roomId: string, message: ServerChatMessage): void {
    this.history.rooms[roomId] = [...this.get(roomId), message]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-100);
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
        this.history = parseHistory(await readFile(candidate, "utf8"));
        this.log?.("chat history loaded", {
          source: candidate === this.filePath ? "primary" : "backup",
        });
        return;
      } catch (error) {
        this.log?.("chat history candidate unavailable", {
          source: candidate === this.filePath ? "primary" : "backup",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private queueWrite(): void {
    if (!this.filePath) return;
    const snapshot = JSON.stringify(this.history, null, 2);
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        const directory = dirname(this.filePath!);
        const temporaryPath = `${this.filePath}.tmp`;
        const backupPath = this.getBackupPath();
        await mkdir(directory, { recursive: true });
        await copyFile(this.filePath!, backupPath).catch(() => undefined);
        await unlink(temporaryPath).catch(() => undefined);
        await writeFile(temporaryPath, snapshot, { encoding: "utf8", flag: "wx" });
        await rename(temporaryPath, this.filePath!);
      })
      .catch((error) => {
        this.log?.("chat history write failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private getBackupPath(): string {
    const parsed = parse(this.filePath!);
    return join(parsed.dir, `${parsed.name}.backup${parsed.ext || ".json"}`);
  }
}
