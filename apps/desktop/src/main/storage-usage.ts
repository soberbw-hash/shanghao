import { lstat, opendir } from "node:fs/promises";
import path from "node:path";
import type { StorageUsage } from "@private-voice/shared";

/** Bounded async inspection, no file contents, no junction/symlink traversal. */
export const inspectStorageDirectory = async (
  category: StorageUsage["category"],
  directory: string,
  { maxEntries = 100_000, timeoutMs = 8_000 } = {},
): Promise<StorageUsage> => {
  const result: StorageUsage = { category, bytes: 0, files: 0, complete: true };
  const pending = [directory];
  const deadline = Date.now() + timeoutMs;
  let examined = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++examined > maxEntries || Date.now() >= deadline) {
      result.complete = false;
      break;
    }
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) continue;
      if (info.isFile()) {
        result.bytes += info.size;
        result.files++;
      } else if (info.isDirectory()) {
        for await (const entry of await opendir(current)) {
          if (pending.length + examined >= maxEntries || Date.now() >= deadline) {
            result.complete = false;
            break;
          }
          if (!entry.isSymbolicLink()) pending.push(path.join(current, entry.name));
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") result.complete = false;
    }
  }
  return result;
};
