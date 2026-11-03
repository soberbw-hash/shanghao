import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { ChatMixLease, ChatMixLeaseJournal } from "./chat-mix-volume-leases";

const LIMIT = 2 * 1024 * 1024;
async function inspect(file: string): Promise<void> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > LIMIT)
      throw Error("chat_mix_journal_invalid");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** One Main owner; caller provides its private, profile-specific recovery path. */
export function chatMixLeaseJournal(file: string): ChatMixLeaseJournal {
  if (!path.isAbsolute(file)) throw Error("chat_mix_journal_invalid_path");
  return {
    async read() {
      await inspect(file);
      let raw: string;
      try {
        raw = await readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
      const value = JSON.parse(raw);
      if (
        !value ||
        value.version !== 1 ||
        !Array.isArray(value.entries) ||
        value.entries.length > 512
      )
        throw Error("chat_mix_journal_invalid");
      return value.entries as ChatMixLease[];
    },
    async write(entries) {
      if (entries.length > 512) throw Error("chat_mix_journal_invalid");
      const raw = JSON.stringify({ version: 1, entries });
      if (Buffer.byteLength(raw) > LIMIT) throw Error("chat_mix_journal_invalid");
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const directory = await lstat(path.dirname(file));
      if (!directory.isDirectory() || directory.isSymbolicLink())
        throw Error("chat_mix_journal_invalid_path");
      await inspect(file);
      try {
        const previous = JSON.parse(await readFile(file, "utf8"));
        if (
          !previous ||
          previous.version !== 1 ||
          !Array.isArray(previous.entries) ||
          previous.entries.length > 512
        )
          throw Error("chat_mix_journal_invalid");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(raw, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    },
  };
}
