import { createHash } from "node:crypto";
import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { LocalChronicleEntry } from "@private-voice/shared";
import { writePrivateFileAtomically } from "./atomic-private-file";

const MAX_ENTRIES = 5000;
const MAX_BYTES = 8 * 1024 * 1024;
export const isLocalChronicleEntry = (value: unknown): value is LocalChronicleEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as LocalChronicleEntry;
  return (
    typeof entry.id === "string" &&
    /^[\w-]{1,128}$/.test(entry.id) &&
    Number.isSafeInteger(entry.at) &&
    entry.at > 0 &&
    typeof entry.text === "string" &&
    !!entry.text.trim() &&
    entry.text.length <= 800 &&
    (entry.reaction === undefined || entry.reaction === "funny" || entry.reaction === "flat")
  );
};

/** Derived stories only. Audio and verbatim transcripts never enter this local archive. */
export class ChronicleArchiveStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly root: string,
    private readonly scope: () => string,
  ) {}

  private async location(scope: string, roomId: string) {
    if (!scope || typeof roomId !== "string" || !/^[\w-]{1,128}$/.test(roomId))
      throw Error("chronicle_archive_scope_invalid");
    await mkdir(this.root, { recursive: true });
    const directory = await lstat(this.root);
    if (!directory.isDirectory() || directory.isSymbolicLink())
      throw Error("chronicle_archive_invalid");
    return path.join(
      this.root,
      createHash("sha256")
        .update(JSON.stringify([scope, roomId]))
        .digest("hex") + ".json",
    );
  }
  private async load(file: string, roomId: string): Promise<LocalChronicleEntry[]> {
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES)
        throw Error("chronicle_archive_invalid");
      const data = JSON.parse(await readFile(file, "utf8"));
      if (
        data.version !== 1 ||
        data.roomId !== roomId ||
        !Array.isArray(data.entries) ||
        data.entries.length > MAX_ENTRIES ||
        !data.entries.every(isLocalChronicleEntry) ||
        new Set(data.entries.map((entry: LocalChronicleEntry) => entry.id)).size !==
          data.entries.length
      )
        throw Error("chronicle_archive_invalid");
      return data.entries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  private run(roomId: string, update?: (entries: LocalChronicleEntry[]) => LocalChronicleEntry[]) {
    const scope = this.scope();
    const operation = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (this.scope() !== scope) throw Error("chronicle_archive_scope_changed");
        const file = await this.location(scope, roomId);
        const entries = await this.load(file, roomId);
        const next = update ? update(entries) : entries;
        if (this.scope() !== scope) throw Error("chronicle_archive_scope_changed");
        if (next !== entries) {
          if (next.length > MAX_ENTRIES) throw Error("chronicle_archive_full");
          const bytes = Buffer.from(JSON.stringify({ version: 1, roomId, entries: next }));
          if (bytes.length > MAX_BYTES) throw Error("chronicle_archive_full");
          await writePrivateFileAtomically(file, bytes);
        }
        // Do not hand an old account's contents back after an asynchronous disk write.
        if (this.scope() !== scope) throw Error("chronicle_archive_scope_changed");
        return next;
      });
    this.queue = operation;
    return operation;
  }
  read(roomId: string) {
    return this.run(roomId);
  }
  append(roomId: string, additions: LocalChronicleEntry[]) {
    if (
      !Array.isArray(additions) ||
      additions.length > 60 ||
      !additions.every(isLocalChronicleEntry)
    )
      return Promise.reject(Error("chronicle_archive_invalid"));
    return this.run(roomId, (entries) => {
      const indexed = new Map(entries.map((entry) => [entry.id, entry]));
      for (const { id, at, text } of additions) {
        const previous = indexed.get(id);
        if (previous && (previous.at !== at || previous.text !== text))
          throw Error("chronicle_archive_conflict");
        if (!previous) indexed.set(id, { id, at, text });
      }
      return indexed.size === entries.length
        ? entries
        : [...indexed.values()].sort((a, b) => a.at - b.at);
    });
  }
  react(roomId: string, id: string, reaction?: LocalChronicleEntry["reaction"]) {
    if (
      typeof id !== "string" ||
      !/^[\w-]{1,128}$/.test(id) ||
      (reaction !== undefined && reaction !== "funny" && reaction !== "flat")
    )
      return Promise.reject(Error("chronicle_archive_invalid"));
    return this.run(roomId, (entries) => {
      if (!entries.some((entry) => entry.id === id)) throw Error("chronicle_archive_not_found");
      return entries.map((entry) => (entry.id === id ? { ...entry, reaction } : entry));
    });
  }
}
