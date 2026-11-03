import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { VoiceMemoryRecord } from "@private-voice/shared";

/** Revoke all previous writer revisions, including ready records with background fusion. */
export function pauseRecycledVoiceMemory(record: VoiceMemoryRecord): VoiceMemoryRecord {
  const interrupted =
    ["queued", "preparing", "transcribing", "organizing"].includes(record.phase) ||
    record.transcriptionFusion?.status === "running" ||
    record.organization?.status === "running" ||
    record.transcriptionUnits?.some((unit) => unit.status === "running");
  return {
    ...record,
    updatedAt: new Date(
      Math.max(Date.now(), (Date.parse(record.updatedAt) || 0) + 1),
    ).toISOString(),
    phase: interrupted ? "paused" : record.phase,
    taskStatus: interrupted ? "pending" : record.taskStatus,
    transcriptionUnits: record.transcriptionUnits?.map((unit) =>
      unit.status === "running" ? { ...unit, status: "pending" } : unit,
    ),
    transcriptionFusion:
      record.transcriptionFusion?.status === "running"
        ? { ...record.transcriptionFusion, status: "failed", errorCode: "ai_task_paused" }
        : record.transcriptionFusion,
    organization:
      record.organization?.status === "running"
        ? {
            ...record.organization,
            status: "paused",
            chunks: record.organization.chunks.map((chunk) =>
              chunk.status === "running" ? { ...chunk, status: "pending" } : chunk,
            ),
          }
        : record.organization,
    diagnostic:
      interrupted && record.diagnostic
        ? { ...record.diagnostic, status: "pending" }
        : record.diagnostic,
  };
}

/** Tombstones live beside the authoritative records: recycling never discards ASR checkpoints. */
export class VoiceMemoryRecycleState {
  constructor(private readonly root: string) {}
  private file(id: string): string {
    return path.join(
      this.root,
      "recycled",
      `${createHash("sha256").update(id).digest("hex")}.json`,
    );
  }
  snapshot(): ReadonlySet<string> {
    try {
      return new Set(readdirSync(path.join(this.root, "recycled")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
      throw error;
    }
  }
  has(id: string, snapshot?: ReadonlySet<string>): boolean {
    if (snapshot) return snapshot.has(path.basename(this.file(id)));
    try {
      lstatSync(this.file(id));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  async set(id: string, token: string, recycled: boolean): Promise<void> {
    if (!/^[a-f0-9-]{36}$/i.test(token)) throw Error("invalid_recycle_token");
    const file = this.file(id);
    let current: unknown;
    try {
      current = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (
      current !== undefined &&
      (!current || typeof current !== "object" || !("token" in current) || current.token !== token)
    )
      throw Error("recording_recycle_conflict");
    if (!recycled) {
      if (current !== undefined) await rm(file);
      return;
    }
    if (current !== undefined) return;
    await mkdir(path.dirname(file), { recursive: true });
    // An interrupted write remains a blocking tombstone, never permission to overwrite data.
    await writeFile(file, JSON.stringify({ version: 1, token }), { flag: "wx" });
  }
}
