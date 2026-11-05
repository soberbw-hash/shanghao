import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { KnownSpeakerTranscriptionSource } from "./speaker-transcript";
import type { VoiceMemoryTranscriptionUnit } from "@private-voice/shared";

/** Lightweight file identity, not a content hash. Never include the path in error text. */
export async function verifySource(
  source: KnownSpeakerTranscriptionSource,
  expected?: string,
): Promise<string> {
  let metadata;
  let actual: string;
  if (!path.isAbsolute(source.filePath)) throw new Error("transcription_source_invalid");
  try {
    metadata = await lstat(source.filePath);
    actual = await realpath(source.filePath);
  } catch {
    throw new Error("transcription_source_missing");
  }
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("transcription_source_invalid");
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        actual,
        metadata.size,
        metadata.mtimeMs,
        metadata.ctimeMs,
        source.speakerId,
        source.accountIdentity ?? "",
        source.audioOffsetMs,
        source.startMs,
        source.endMs,
      ]),
    )
    .digest("hex");
  if (expected && fingerprint !== expected) throw new Error("transcription_source_changed");
  return fingerprint;
}

/** Do not call a run complete if an earlier source changed while later units ran. */
export async function verifyCompletedSources(
  sources: readonly KnownSpeakerTranscriptionSource[],
  units: readonly VoiceMemoryTranscriptionUnit[],
  signal?: AbortSignal,
): Promise<void> {
  for (let index = 0; index < units.length; index++) {
    if (signal?.aborted) throw new Error("ai_task_paused");
    const unit = units[index];
    const source = sources[index];
    if (unit?.status !== "completed" || !unit.sourceFingerprint) continue;
    if (!source) throw new Error("transcription_source_missing");
    await verifySource(source, unit.sourceFingerprint);
  }
}
