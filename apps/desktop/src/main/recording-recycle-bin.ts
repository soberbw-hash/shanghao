import { randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { RecordingLibraryItem } from "@private-voice/shared";
import { acquireArtifactLock } from "./runtime-artifact-download";
import {
  detachRecycledRecordingCatalog,
  markerPathFor,
  moveRecordingToRecycleBin,
  restoreRecordingFromRecycleBin,
} from "./recording-library-core";

export const RECORDING_RECYCLE_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface RecycleEntry {
  version: 1;
  id: string;
  deletedAt: string;
  expiresAt: string;
  item: RecordingLibraryItem;
  phase: "moving" | "ready" | "restoring" | "purging";
}
export interface RecordingRecycleHooks {
  suspend: (item: RecordingLibraryItem, token: string) => Promise<void>;
  resume: (item: RecordingLibraryItem, token: string) => Promise<void>;
  purge: (item: RecordingLibraryItem, token: string) => Promise<void>;
}
const optionalFile = async (file: string) => {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error("recording_recycle_invalid_file");
    return stat;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};
/** Same-volume file journal. Ancillary ASR/track files remain tombstoned until expiration. */
export class RecordingRecycleBin {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly root: string;
  constructor(
    private readonly directory: string,
    private readonly hooks: RecordingRecycleHooks,
    private readonly now: () => number = Date.now,
  ) {
    this.directory = path.resolve(directory);
    this.root = path.join(this.directory, ".shanghao-recycle-bin");
  }
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        await this.prepare();
        const release = await acquireArtifactLock(
          path.join(this.root, "access"),
          undefined,
          15_000,
        );
        try {
          return await operation();
        } finally {
          await release();
        }
      });
    this.queue = task;
    return task;
  }
  private folder(id: string): string {
    if (typeof id !== "string" || !UUID.test(id)) throw Error("invalid_recording_recycle_id");
    return path.join(this.root, id);
  }
  private async prepare(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const info = await lstat(this.root);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error("recording_recycle_invalid_directory");
  }
  private async write(entry: RecycleEntry): Promise<void> {
    const file = path.join(this.folder(entry.id), "entry.json");
    const temp = `${file}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(entry), { flag: "wx" });
    await rename(temp, file);
  }
  private async read(id: string): Promise<RecycleEntry> {
    const folder = this.folder(id);
    const info = await lstat(folder);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw Error("recording_recycle_invalid_directory");
    const file = path.join(folder, "entry.json");
    const manifest = await optionalFile(file);
    if (!manifest || manifest.size > 128 * 1024) throw Error("recording_recycle_invalid_manifest");
    const entry = JSON.parse(await readFile(file, "utf8")) as RecycleEntry;
    const item = entry?.item;
    if (
      entry.version !== 1 ||
      entry.id !== id ||
      !["moving", "ready", "restoring", "purging"].includes(entry.phase) ||
      !Number.isFinite(Date.parse(entry.deletedAt)) ||
      Date.parse(entry.expiresAt) !==
        Date.parse(entry.deletedAt) + RECORDING_RECYCLE_RETENTION_MS ||
      !item ||
      typeof item.recordingId !== "string" ||
      !item.recordingId.length ||
      item.recordingId.length > 2048 ||
      typeof item.title !== "string" ||
      typeof item.fileName !== "string" ||
      path.basename(item.fileName) !== item.fileName ||
      path.extname(item.fileName).toLowerCase() !== ".m4a" ||
      path.resolve(item.filePath) !== path.join(this.directory, item.fileName) ||
      !Number.isSafeInteger(item.fileSize) ||
      item.fileSize < 0 ||
      !Array.isArray(item.markers)
    )
      throw Error("recording_recycle_invalid_manifest");
    return entry;
  }
  /** A hard-link reservation prevents POSIX rename from silently replacing a new recording. */
  private async moveExclusive(source: string, destination: string): Promise<void> {
    const original = await optionalFile(source);
    if (!original) return;
    try {
      await link(source, destination);
    } catch (error) {
      const previous = await optionalFile(destination);
      // Recover a crash between link and unlink only when both names identify the same inode.
      if (
        (error as NodeJS.ErrnoException).code !== "EEXIST" ||
        !previous ||
        !original.ino ||
        original.dev !== previous.dev ||
        original.ino !== previous.ino
      )
        throw error;
    }
    await unlink(source);
  }
  private async finishMove(entry: RecycleEntry): Promise<void> {
    const audio = path.join(this.folder(entry.id), "audio.m4a");
    const source = await optionalFile(entry.item.filePath);
    const archived = await optionalFile(audio);
    if (!archived && source) {
      if (
        source.size !== entry.item.fileSize ||
        source.mtime.toISOString() !== entry.item.modifiedAt
      )
        throw Error("recording_changed_since_scan");
      await this.moveExclusive(entry.item.filePath, audio);
    } else if (
      archived &&
      source &&
      archived.dev === source.dev &&
      archived.ino &&
      archived.ino === source.ino
    ) {
      await this.moveExclusive(entry.item.filePath, audio);
    } else if (
      !archived ||
      source ||
      archived.size !== entry.item.fileSize ||
      archived.mtime.toISOString() !== entry.item.modifiedAt
    )
      throw Error("recording_recycle_conflict");
    const marker = markerPathFor(entry.item.filePath);
    if (await optionalFile(marker))
      await this.moveExclusive(marker, path.join(this.folder(entry.id), "markers.txt"));
    entry.phase = "ready";
    await this.write(entry);
  }
  async recycle(item: RecordingLibraryItem, protect = false): Promise<void> {
    return this.run(async () => {
      await this.prepare();
      const id = randomUUID();
      const deletedAt = this.now();
      const entry: RecycleEntry = {
        version: 1,
        id,
        deletedAt: new Date(deletedAt).toISOString(),
        expiresAt: new Date(deletedAt + RECORDING_RECYCLE_RETENTION_MS).toISOString(),
        item,
        phase: "moving",
      };
      // Validate before interrupting a task, then recheck under the same queue at commit time.
      await moveRecordingToRecycleBin(this.directory, item, protect, async () => undefined);
      await mkdir(this.folder(id));
      await this.write(entry); // Persist intent before revoking tasks or moving any bytes.
      try {
        // Task setup can read the catalog: never await it while owning the catalog queue.
        await this.hooks.suspend(item, id);
        await moveRecordingToRecycleBin(this.directory, item, protect, () =>
          this.finishMove(entry),
        );
      } catch (error) {
        if (
          !(await optionalFile(path.join(this.folder(id), "audio.m4a"))) &&
          (await optionalFile(item.filePath))
        ) {
          await this.hooks.resume(item, id);
          await this.removeManifest(entry);
        }
        throw error;
      }
    });
  }
  private async finishRestore(entry: RecycleEntry): Promise<void> {
    await restoreRecordingFromRecycleBin(this.directory, entry.item, async () => {
      const audio = path.join(this.folder(entry.id), "audio.m4a");
      const archived = await optionalFile(audio);
      const original = await optionalFile(entry.item.filePath);
      if (
        archived &&
        original &&
        (!archived.ino || archived.dev !== original.dev || archived.ino !== original.ino)
      )
        throw Error("recording_restore_conflict");
      if (archived) await this.moveExclusive(audio, entry.item.filePath);
      else if (
        !original ||
        original.size !== entry.item.fileSize ||
        original.mtime.toISOString() !== entry.item.modifiedAt
      )
        throw Error("recording_restore_conflict");
      await this.moveExclusive(
        path.join(this.folder(entry.id), "markers.txt"),
        markerPathFor(entry.item.filePath),
      );
    });
    await this.hooks.resume(entry.item, entry.id);
    await this.removeManifest(entry);
  }
  private async removeManifest(entry: RecycleEntry): Promise<void> {
    await unlink(path.join(this.folder(entry.id), "entry.json"));
    // Never recurse over a path derived from renderer input or an untrusted manifest.
    const { rmdir } = await import("node:fs/promises");
    await rmdir(this.folder(entry.id)).catch(() => undefined);
  }
  async restore(id: string): Promise<void> {
    return this.run(async () => {
      await this.prepare();
      const entry = await this.read(id);
      if (entry.phase !== "ready" && entry.phase !== "restoring")
        throw Error("recording_recycle_not_ready");
      if (entry.phase === "ready" && (await optionalFile(entry.item.filePath)))
        throw Error("recording_restore_conflict");
      entry.phase = "restoring";
      await this.write(entry);
      await this.finishRestore(entry);
    });
  }
  async list(): Promise<RecycleEntry[]> {
    return this.run(async () => {
      await this.prepare();
      const result: RecycleEntry[] = [];
      for (const name of (await readdir(this.root)).filter((name) => UUID.test(name))) {
        const entry = await this.read(name); // Corruption stops maintenance; no destructive guesswork.
        if (entry.phase === "moving") {
          if (
            !(await optionalFile(path.join(this.folder(entry.id), "audio.m4a"))) &&
            (await optionalFile(entry.item.filePath))
          ) {
            await this.hooks.resume(entry.item, entry.id);
            await this.removeManifest(entry);
            continue;
          }
          await this.hooks.suspend(entry.item, entry.id);
          await this.finishMove(entry);
        }
        if (entry.phase === "restoring") {
          await this.finishRestore(entry);
          continue;
        }
        await detachRecycledRecordingCatalog(this.directory, entry.item);
        result.push(entry);
      }
      return result.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
    });
  }
  async purgeExpired(): Promise<number> {
    const entries = await this.list();
    return this.run(async () => {
      let count = 0;
      for (const previous of entries) {
        const entry = await this.read(previous.id);
        if (
          Date.parse(entry.expiresAt) > this.now() ||
          entry.phase === "restoring" ||
          entry.phase === "moving"
        )
          continue;
        // A newly imported live file always wins over expiry, even if it reused the old name.
        if (await optionalFile(entry.item.filePath)) continue;
        entry.phase = "purging";
        await this.write(entry);
        await this.hooks.purge(entry.item, entry.id);
        for (const name of ["audio.m4a", "markers.txt"]) {
          const target = path.join(this.folder(entry.id), name);
          if (await optionalFile(target)) await rm(target);
        }
        await this.removeManifest(entry);
        count++;
      }
      return count;
    });
  }
}
