import { randomUUID } from "node:crypto";
import { lstat, readdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { temporaryRecordingName } from "./asr-benchmark-runtime";

export const asrTemporaryDirectory = (): string => path.join(os.tmpdir(), "shanghao-voice-memory");

export const createAsrTemporaryWavPath = (
  recordingId: string,
  offsetMs: number,
  directory = asrTemporaryDirectory(),
): string =>
  path.join(
    directory,
    `${temporaryRecordingName(recordingId)}-${offsetMs}-${process.pid}-${randomUUID()}.wav`,
  );

const isOwnedWavName = (name: string): boolean => {
  if (!name.endsWith(".wav") || name.length > 100) return false;
  const parts = name.slice(0, -4).split("-");
  if (parts.length !== 3 && parts.length !== 8) return false;
  if (!/^[a-f0-9]{20}$/iu.test(parts[0] ?? "")) return false;
  if (!/^\d+$/u.test(parts[1] ?? "") || !/^\d+$/u.test(parts[2] ?? "")) return false;
  if (parts.length === 3) return true;
  return [8, 4, 4, 4, 12].every((length, index) => {
    const part = parts[index + 3] ?? "";
    return part.length === length && /^[a-f0-9]+$/iu.test(part);
  });
};
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_REMOVALS_PER_RUN = 100;
const processIsAlive = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
};

export interface AsrTempCleanupResult {
  examined: number;
  removed: number;
  removedBytes: number;
}

/** Only remove old, regular WAV files bearing our exact temporary name in our own directory. */
export const pruneStaleAsrTempFiles = async (
  directory = asrTemporaryDirectory(),
  now = Date.now(),
  isProcessAlive = processIsAlive,
): Promise<AsrTempCleanupResult> => {
  const result: AsrTempCleanupResult = { examined: 0, removed: 0, removedBytes: 0 };
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  for (const entry of entries) {
    if (result.removed >= MAX_REMOVALS_PER_RUN) break;
    if (!entry.isFile() || !isOwnedWavName(entry.name)) continue;
    const parts = entry.name.slice(0, -4).split("-");
    if (parts.length === 8 && isProcessAlive(Number(parts[2]))) continue;
    result.examined++;
    const target = path.join(directory, entry.name);
    const info = await lstat(target).catch(() => undefined);
    if (!info?.isFile() || info.isSymbolicLink() || now - info.mtimeMs < STALE_AFTER_MS) continue;
    try {
      await unlink(target);
      result.removed++;
      result.removedBytes += info.size;
    } catch {
      // Windows keeps open files locked. Leave them for a later startup.
    }
  }
  return result;
};
