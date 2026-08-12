import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ChatMessage } from "@private-voice/shared";

const CHAT_HISTORY_VERSION = 1;
const MAX_ROOMS = 8;
const MAX_MESSAGES_PER_ROOM = 500;
const MAX_ROOM_BYTES = 24 * 1024 * 1024;

interface CachedRoomHistory {
  updatedAt: string;
  messages: ChatMessage[];
}

interface ChatHistoryFile {
  version: typeof CHAT_HISTORY_VERSION;
  rooms: Record<string, CachedRoomHistory>;
}

const emptyHistory = (): ChatHistoryFile => ({
  version: CHAT_HISTORY_VERSION,
  rooms: {},
});

const isChatMessage = (value: unknown): value is ChatMessage => {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ChatMessage>;
  return (
    typeof message.id === "string" &&
    typeof message.peerId === "string" &&
    typeof message.nickname === "string" &&
    typeof message.content === "string" &&
    typeof message.createdAt === "string"
  );
};

const trimMessages = (messages: ChatMessage[]): ChatMessage[] => {
  const byId = new Map<string, ChatMessage>();
  for (const message of messages) {
    if (isChatMessage(message)) byId.set(message.id, message);
  }

  const trimmed = [...byId.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-MAX_MESSAGES_PER_ROOM);

  while (
    trimmed.length > 0 &&
    Buffer.byteLength(JSON.stringify(trimmed), "utf8") > MAX_ROOM_BYTES
  ) {
    trimmed.shift();
  }
  return trimmed;
};

export class ChatHistoryStore {
  private readonly filePath: string;
  private readonly temporaryFilePath: string;
  private cache?: ChatHistoryFile;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataDirectory: string) {
    this.filePath = path.join(userDataDirectory, "chat-history.json");
    this.temporaryFilePath = path.join(userDataDirectory, "chat-history.tmp.json");
  }

  async read(roomKey: string): Promise<ChatMessage[]> {
    await this.writeQueue.catch(() => undefined);
    const history = await this.load();
    return [...(history.rooms[roomKey]?.messages ?? [])];
  }

  async save(roomKey: string, messages: ChatMessage[]): Promise<void> {
    const nextMessages = trimMessages(messages);
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        const history = await this.load();
        history.rooms[roomKey] = {
          updatedAt: new Date().toISOString(),
          messages: nextMessages,
        };

        const orderedRooms = Object.entries(history.rooms).sort((left, right) =>
          right[1].updatedAt.localeCompare(left[1].updatedAt),
        );
        history.rooms = Object.fromEntries(orderedRooms.slice(0, MAX_ROOMS));

        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(this.temporaryFilePath, JSON.stringify(history), "utf8");
        await rename(this.temporaryFilePath, this.filePath);
      });
    return this.writeQueue;
  }

  private async load(): Promise<ChatHistoryFile> {
    if (this.cache) return this.cache;
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<ChatHistoryFile>;
      if (
        parsed.version !== CHAT_HISTORY_VERSION ||
        !parsed.rooms ||
        typeof parsed.rooms !== "object"
      ) {
        this.cache = emptyHistory();
        return this.cache;
      }

      const rooms: Record<string, CachedRoomHistory> = {};
      for (const [roomKey, value] of Object.entries(parsed.rooms)) {
        if (!value || typeof value !== "object") continue;
        const room = value as Partial<CachedRoomHistory>;
        rooms[roomKey] = {
          updatedAt:
            typeof room.updatedAt === "string" ? room.updatedAt : new Date(0).toISOString(),
          messages: trimMessages(Array.isArray(room.messages) ? room.messages : []),
        };
      }
      this.cache = { version: CHAT_HISTORY_VERSION, rooms };
    } catch {
      this.cache = emptyHistory();
    }
    return this.cache;
  }
}
