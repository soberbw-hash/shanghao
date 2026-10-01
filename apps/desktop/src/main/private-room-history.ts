import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  isPrivateRoomInfo,
  isPrivateRoomId,
  type PrivateRoomHistory,
  type PrivateRoomInfo,
} from "@private-voice/shared";
import { writePrivateFileAtomically } from "./atomic-private-file";

interface HistoryFile extends PrivateRoomHistory {
  version: 1;
}
const empty = (): HistoryFile => ({ version: 1, recent: [], favorites: [] });
const validate = (value: unknown): HistoryFile => {
  if (!value || typeof value !== "object") throw new Error("room_history_unreadable");
  const data = value as HistoryFile;
  if (
    data.version !== 1 ||
    !Array.isArray(data.recent) ||
    !Array.isArray(data.favorites) ||
    data.recent.length > 20 ||
    data.favorites.length > 100 ||
    !data.recent.every(isPrivateRoomInfo) ||
    !data.favorites.every(isPrivateRoomInfo) ||
    new Set(data.recent.map((room) => room.roomId)).size !== data.recent.length ||
    new Set(data.favorites.map((room) => room.roomId)).size !== data.favorites.length ||
    (data.lastRoomId !== undefined && !isPrivateRoomId(data.lastRoomId))
  )
    throw new Error("room_history_unreadable");
  return data;
};

/** Account and server scoped navigation history; never a membership or settings authority. */
export class PrivateRoomHistoryStore {
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(private readonly userData: string) {}
  async read(scope: string): Promise<PrivateRoomHistory> {
    await this.queues.get(scope)?.catch(() => undefined);
    return this.load(scope);
  }
  remember(scope: string, room: PrivateRoomInfo): Promise<PrivateRoomHistory> {
    return this.mutate(scope, (history) => {
      history.lastRoomId = room.roomId;
      history.recent = [
        room,
        ...history.recent.filter((item) => item.roomId !== room.roomId),
      ].slice(0, 20);
      history.favorites = history.favorites.map((item) =>
        item.roomId === room.roomId ? room : item,
      );
    });
  }
  favorite(scope: string, room: PrivateRoomInfo, enabled: boolean): Promise<PrivateRoomHistory> {
    return this.mutate(scope, (history) => {
      history.favorites = history.favorites.filter((item) => item.roomId !== room.roomId);
      if (enabled) {
        if (history.favorites.length >= 100) throw new Error("room_favorites_full");
        history.favorites.unshift(room);
      }
    });
  }
  removeFavorite(scope: string, roomId: string): Promise<PrivateRoomHistory> {
    return this.mutate(scope, (history) => {
      history.favorites = history.favorites.filter((room) => room.roomId !== roomId);
    });
  }
  private file(scope: string): string {
    return path.join(
      this.userData,
      "private-rooms",
      `${createHash("sha256").update(scope).digest("hex")}.json`,
    );
  }
  private async load(scope: string): Promise<HistoryFile> {
    try {
      const file = this.file(scope);
      if ((await stat(file)).size > 256 * 1024) throw new Error("room_history_unreadable");
      return validate(JSON.parse(await readFile(file, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
      throw error;
    }
  }
  private mutate(
    scope: string,
    operation: (history: HistoryFile) => void,
  ): Promise<PrivateRoomHistory> {
    const previous = this.queues.get(scope) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const history = await this.load(scope);
        operation(history);
        await writePrivateFileAtomically(
          this.file(scope),
          Buffer.from(JSON.stringify(validate(history)), "utf8"),
        );
        return history;
      });
    this.queues.set(scope, next);
    void next
      .finally(() => {
        if (this.queues.get(scope) === next) this.queues.delete(scope);
      })
      .catch(() => undefined);
    return next;
  }
}
