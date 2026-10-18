import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VoiceMemoryRecord, VoiceMemoryTranscriptionUnit } from "@private-voice/shared";
import { hasInvalidVoiceMemoryResult } from "@private-voice/shared";
import { acquireArtifactLock } from "./runtime-artifact-download";
import {
  VoiceMemoryStore,
  isVoiceMemoryRecord,
  normalizeLegacyRecord,
  type VoiceMemorySaveOptions,
} from "./voice-memory-store";

const optionalRead = async (file: string): Promise<string | undefined> => {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};
const filesIn = async (directory: string): Promise<string[]> => {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
};
const completed = (record: VoiceMemoryRecord) =>
  record.phase === "ready" && record.transcript.length > 0 && !hasInvalidVoiceMemoryResult(record);

/** Shared records remain compatible with the installed release's JSON format. */
export class SharedVoiceMemoryStore extends VoiceMemoryStore {
  private queue: Promise<unknown> = Promise.resolve();
  private fingerprint?: string;
  constructor(private readonly directory: string) {
    super(directory);
  }

  override async initialize(): Promise<void> {
    await this.transaction(async () => {
      await this.importLegacyProfiles();
    });
  }

  override async listSummaries(options: { limit?: number; offset?: number } = {}) {
    return this.transaction(() => super.listSummaries(options));
  }

  override async save(record: VoiceMemoryRecord, options: VoiceMemorySaveOptions = {}) {
    return this.transaction(async () => {
      const current = await super.get(record.recordingId);
      // A stale job from another profile cannot erase a completed shared transcript.
      // Explicit re-transcription starts from the current revision and remains possible.
      if (
        current &&
        completed(current) &&
        current.updatedAt !== record.updatedAt &&
        record.transcript.length < current.transcript.length
      )
        throw new Error("voice_memory_shared_result_changed");
      return super.save(record, options);
    });
  }

  override async delete(recordingId: string) {
    return this.transaction(() => super.delete(recordingId));
  }

  override async appendTranscriptionUnit(recordingId: string, unit: VoiceMemoryTranscriptionUnit) {
    return this.transaction(() => super.appendTranscriptionUnit(recordingId, unit));
  }

  private async snapshot(): Promise<string> {
    const files = [
      "index.json",
      "summaries.json",
      "pending-metadata.json",
      ...(await filesIn(path.join(this.directory, "records"))).map((name) => `records/${name}`),
    ];
    const signatures: string[] = [];
    for (const file of files) {
      try {
        const info = await stat(path.join(this.directory, file), { bigint: true });
        signatures.push(`${file}:${info.mtimeNs}:${info.size}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return signatures.join("|");
  }

  private transaction<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        const release = await acquireArtifactLock(
          path.join(this.directory, "shared-access"),
          undefined,
          15_000,
        );
        try {
          if (this.fingerprint !== (await this.snapshot())) {
            await super.initialize();
            // Old releases can write stale aggregate indexes; records are authoritative.
            await super.rebuildMetadata();
          }
          const value = await operation();
          this.fingerprint = await this.snapshot();
          return value;
        } finally {
          await release();
        }
      });
    this.queue = result;
    return result;
  }

  private async importLegacyProfiles(): Promise<void> {
    // Only the canonical real profile imports siblings. Capture/test roots stay isolated.
    const profile = path.dirname(this.directory);
    if (path.basename(profile).toLowerCase() !== "shanghao") return;
    const ledgerPath = path.join(this.directory, "profile-imports.json");
    const rawLedger = await optionalRead(ledgerPath);
    const ledger: unknown = rawLedger === undefined ? {} : JSON.parse(rawLedger);
    if (
      !ledger ||
      typeof ledger !== "object" ||
      Array.isArray(ledger) ||
      Object.values(ledger).some((hash) => typeof hash !== "string")
    ) {
      throw new Error("voice_memory_import_ledger_unreadable");
    }
    const imported = ledger as Record<string, string>;
    let changed = false;
    for (const name of ["shanghao-desktop", "上号"]) {
      const source = path.join(path.dirname(profile), name, "voice-memory");
      for (const file of await filesIn(path.join(source, "records"))) {
        const sourcePath = path.join(source, "records", file);
        const content = await optionalRead(sourcePath);
        if (content === undefined) continue;
        const hash = createHash("sha256").update(content).digest("hex");
        const key = `${name}/${file}`;
        // File-content deduplication, not a credential comparison.
        // eslint-disable-next-line security/detect-possible-timing-attacks
        if (imported[key] === hash) continue;
        const parsed: unknown = JSON.parse(content);
        if (!isVoiceMemoryRecord(parsed)) throw new Error("voice_memory_legacy_record_unreadable");
        const record = normalizeLegacyRecord(parsed);
        const current = await super.get(record.recordingId);
        if (!current || (completed(record) && !completed(current))) {
          const backup = path.join(this.directory, "profile-import-backups", name, hash);
          await mkdir(backup, { recursive: true });
          await copyFile(sourcePath, path.join(backup, "source.json"));
          if (current)
            await writeFile(path.join(backup, "previous-shared.json"), JSON.stringify(current));
          await super.save(record);
        }
        imported[key] = hash;
        changed = true;
      }
    }
    if (changed) {
      const temporary = `${ledgerPath}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(imported), { flag: "wx" });
      await rename(temporary, ledgerPath);
    }
  }
}
