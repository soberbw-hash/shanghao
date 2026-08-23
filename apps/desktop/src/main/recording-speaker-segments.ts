import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

import type {
  RecordingSpeakerSegmentFinalizePayload,
  RecordingSpeakerSegmentPayload,
  RecordingSpeakerSegmentResponse,
} from "@private-voice/shared";

export interface PersistedRecordingSpeakerSegment {
  filePath: string;
  speakerId: string;
  displayNameSnapshot: string;
  startMs: number;
  endMs: number;
}

interface SpeakerSegmentManifest {
  schemaVersion: 1;
  sessionId: string;
  recordingId?: string;
  recordingFilePath?: string;
  segments: PersistedRecordingSpeakerSegment[];
}

const safeId = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 96);
  if (!normalized) throw new Error("invalid_recording_segment_id");
  return normalized;
};

const rootDirectory = (): string => path.join(app.getPath("userData"), "speaker-segments");
const pendingDirectory = (sessionId: string): string =>
  path.join(rootDirectory(), "pending", safeId(sessionId));
const completedDirectory = (recordingId: string): string =>
  path.join(rootDirectory(), "recordings", safeId(recordingId));
const manifestPath = (directory: string): string => path.join(directory, "manifest.json");
const sessionWrites = new Map<string, Promise<RecordingSpeakerSegmentResponse>>();

const readManifest = async (
  directory: string,
  sessionId: string,
): Promise<SpeakerSegmentManifest> => {
  try {
    const parsed = JSON.parse(
      await readFile(manifestPath(directory), "utf8"),
    ) as SpeakerSegmentManifest;
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.segments)) return parsed;
  } catch {
    // A first segment creates the manifest. A damaged manifest never deletes retained audio.
  }
  return { schemaVersion: 1, sessionId, segments: [] };
};

const writeManifest = async (
  directory: string,
  manifest: SpeakerSegmentManifest,
): Promise<void> => {
  const targetPath = manifestPath(directory);
  const temporaryPath = `${targetPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(manifest, null, 2), "utf8");
  await rename(temporaryPath, targetPath);
};

const extensionForMime = (mimeType: string): string =>
  mimeType.includes("ogg") ? ".ogg" : mimeType.includes("mp4") ? ".m4a" : ".webm";

const saveRecordingSpeakerSegmentNow = async (
  payload: RecordingSpeakerSegmentPayload,
): Promise<RecordingSpeakerSegmentResponse> => {
  try {
    const directory = pendingDirectory(payload.sessionId);
    await mkdir(directory, { recursive: true });
    const manifest = await readManifest(directory, safeId(payload.sessionId));
    const index = manifest.segments.length;
    const startMs = Math.max(0, Math.round(payload.startMs));
    const endMs = Math.max(startMs + 1, Math.round(payload.endMs));
    const filePath = path.join(
      directory,
      `${String(index).padStart(6, "0")}-${startMs}-${endMs}${extensionForMime(payload.sourceMimeType)}`,
    );
    await writeFile(filePath, Buffer.from(payload.buffer));
    manifest.segments.push({
      filePath,
      speakerId: payload.speakerId.slice(0, 128),
      displayNameSnapshot: payload.displayNameSnapshot.trim().slice(0, 80) || "未知成员",
      startMs,
      endMs,
    });
    await writeManifest(directory, manifest);
    return { ok: true, filePath };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : "speaker_segment_save_failed",
    };
  }
};

export const saveRecordingSpeakerSegment = (
  payload: RecordingSpeakerSegmentPayload,
): Promise<RecordingSpeakerSegmentResponse> => {
  const sessionId = safeId(payload.sessionId);
  const previous = sessionWrites.get(sessionId) ?? Promise.resolve({ ok: true });
  const next = previous
    .catch(() => ({ ok: false }))
    .then(() => saveRecordingSpeakerSegmentNow(payload));
  sessionWrites.set(sessionId, next);
  void next.finally(() => {
    if (sessionWrites.get(sessionId) === next) sessionWrites.delete(sessionId);
  });
  return next;
};

export const finalizeRecordingSpeakerSegments = async (
  payload: RecordingSpeakerSegmentFinalizePayload,
): Promise<void> => {
  await sessionWrites.get(safeId(payload.sessionId));
  const sourceDirectory = pendingDirectory(payload.sessionId);
  const targetDirectory = completedDirectory(payload.recordingId);
  await mkdir(targetDirectory, { recursive: true });
  const manifest = await readManifest(sourceDirectory, safeId(payload.sessionId));
  const copiedSegments: PersistedRecordingSpeakerSegment[] = [];
  for (const segment of manifest.segments) {
    const name = path.basename(segment.filePath);
    const targetPath = path.join(targetDirectory, name);
    await writeFile(targetPath, await readFile(segment.filePath));
    copiedSegments.push({ ...segment, filePath: targetPath });
  }
  await writeManifest(targetDirectory, {
    ...manifest,
    recordingId: payload.recordingId,
    recordingFilePath: path.resolve(payload.recordingFilePath),
    segments: copiedSegments,
  });
  await rm(sourceDirectory, { recursive: true, force: true });
};

export const loadRecordingSpeakerSegments = async (
  recordingId: string,
  recordingFilePath: string,
): Promise<PersistedRecordingSpeakerSegment[] | undefined> => {
  const directory = completedDirectory(recordingId);
  const manifest = await readManifest(directory, "completed");
  if (
    manifest.recordingId !== recordingId ||
    path.resolve(manifest.recordingFilePath ?? "") !== path.resolve(recordingFilePath) ||
    manifest.segments.length === 0
  ) {
    return undefined;
  }
  const existingNames = new Set(await readdir(directory));
  return manifest.segments.filter((segment) => existingNames.has(path.basename(segment.filePath)));
};

export const cleanupRecordingSpeakerSegments = async (recordingId: string): Promise<void> => {
  await rm(completedDirectory(recordingId), { recursive: true, force: true });
};
