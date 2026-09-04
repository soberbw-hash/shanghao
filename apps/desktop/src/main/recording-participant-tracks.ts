import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { app } from "electron";

import type {
  RecordingParticipantTrackPayload,
  RecordingParticipantTrackResponse,
  RecordingParticipantTracksFinalizePayload,
} from "@private-voice/shared";

export interface PersistedParticipantTrack {
  filePath: string;
  userId: string;
  speakerId: string;
  displayNameSnapshot: string;
  avatarId?: string;
  trackId: string;
  roomId: "main" | "side";
  joinedAt?: string;
  startMs: number;
  endMs: number;
}

interface ParticipantTrackManifest {
  schemaVersion: 1;
  sessionId: string;
  recordingId?: string;
  recordingFilePath?: string;
  tracks: PersistedParticipantTrack[];
}

const safeId = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 96);
  if (!normalized) throw new Error("invalid_recording_participant_track_id");
  return normalized;
};

const applicationPath = (name: "userData" | "appData"): string => {
  const electronPath = app?.getPath?.(name);
  if (electronPath) return electronPath;
  const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
  return name === "appData" ? appData : path.join(appData, "shanghao-desktop");
};

const knownUserDataDirectories = (): string[] => {
  const current = path.resolve(applicationPath("userData"));
  const appData = path.resolve(applicationPath("appData"));
  // Capture/visual-test profiles deliberately live outside AppData and must stay isolated.
  if (path.dirname(current).toLowerCase() !== appData.toLowerCase()) return [current];
  return [
    current,
    ...["shanghao-desktop", "shanghao", "上号"].map((name) => path.join(appData, name)),
  ].filter((directory, index, directories) => directories.indexOf(directory) === index);
};
const rootDirectory = (userDataDirectory = applicationPath("userData")): string =>
  path.join(userDataDirectory, "participant-tracks");
const pendingDirectory = (sessionId: string): string =>
  path.join(rootDirectory(), "pending", safeId(sessionId));
const completedDirectory = (recordingId: string): string =>
  path.join(rootDirectory(), "recordings", safeId(recordingId));
const completedDirectories = (recordingId: string): string[] =>
  knownUserDataDirectories().map((directory) =>
    path.join(rootDirectory(directory), "recordings", safeId(recordingId)),
  );
const manifestPath = (directory: string): string => path.join(directory, "manifest.json");
const sessionWrites = new Map<string, Promise<RecordingParticipantTrackResponse>>();

const extensionForMime = (mimeType: string): string =>
  mimeType.includes("ogg") ? ".ogg" : mimeType.includes("mp4") ? ".m4a" : ".webm";

const readManifest = async (
  directory: string,
  sessionId: string,
): Promise<ParticipantTrackManifest> => {
  try {
    const parsed = JSON.parse(
      await readFile(manifestPath(directory), "utf8"),
    ) as ParticipantTrackManifest;
    if (parsed.schemaVersion === 1 && Array.isArray(parsed.tracks)) return parsed;
  } catch {
    // The first track creates the manifest. A damaged manifest never deletes retained audio.
  }
  return { schemaVersion: 1, sessionId, tracks: [] };
};

const writeManifest = async (
  directory: string,
  manifest: ParticipantTrackManifest,
): Promise<void> => {
  const targetPath = manifestPath(directory);
  const temporaryPath = `${targetPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(manifest, null, 2), "utf8");
  await rename(temporaryPath, targetPath);
};

const saveParticipantTrackNow = async (
  payload: RecordingParticipantTrackPayload,
): Promise<RecordingParticipantTrackResponse> => {
  try {
    const directory = pendingDirectory(payload.sessionId);
    await mkdir(directory, { recursive: true });
    const manifest = await readManifest(directory, safeId(payload.sessionId));
    const index = manifest.tracks.length;
    const startMs = Math.max(0, Math.round(payload.startMs));
    const endMs = Math.max(startMs + 1, Math.round(payload.endMs));
    const filePath = path.join(
      directory,
      `${String(index).padStart(4, "0")}-${safeId(payload.userId)}-${startMs}-${endMs}${extensionForMime(payload.sourceMimeType)}`,
    );
    await writeFile(filePath, Buffer.from(payload.buffer));
    manifest.tracks.push({
      filePath,
      userId: payload.userId.slice(0, 128),
      speakerId: payload.speakerId.slice(0, 128),
      displayNameSnapshot: payload.displayNameSnapshot.trim().slice(0, 80) || "未知成员",
      avatarId: payload.avatarId?.slice(0, 64),
      trackId: payload.trackId.slice(0, 128),
      roomId: payload.roomId,
      joinedAt: payload.joinedAt,
      startMs,
      endMs,
    });
    await writeManifest(directory, manifest);
    return { ok: true, filePath };
  } catch (error) {
    return {
      ok: false,
      errorMessage: error instanceof Error ? error.message : "participant_track_save_failed",
    };
  }
};

export const saveRecordingParticipantTrack = (
  payload: RecordingParticipantTrackPayload,
): Promise<RecordingParticipantTrackResponse> => {
  const sessionId = safeId(payload.sessionId);
  const previous = sessionWrites.get(sessionId) ?? Promise.resolve({ ok: true });
  const next = previous.catch(() => ({ ok: false })).then(() => saveParticipantTrackNow(payload));
  sessionWrites.set(sessionId, next);
  void next.finally(() => {
    if (sessionWrites.get(sessionId) === next) sessionWrites.delete(sessionId);
  });
  return next;
};

export const finalizeRecordingParticipantTracks = async (
  payload: RecordingParticipantTracksFinalizePayload,
): Promise<void> => {
  await sessionWrites.get(safeId(payload.sessionId));
  const sourceDirectory = pendingDirectory(payload.sessionId);
  const targetDirectory = completedDirectory(payload.recordingId);
  await mkdir(targetDirectory, { recursive: true });
  const manifest = await readManifest(sourceDirectory, safeId(payload.sessionId));
  const copiedTracks: PersistedParticipantTrack[] = [];
  for (const track of manifest.tracks) {
    const name = path.basename(track.filePath);
    const targetPath = path.join(targetDirectory, name);
    await writeFile(targetPath, await readFile(track.filePath));
    copiedTracks.push({ ...track, filePath: targetPath });
  }
  await writeManifest(targetDirectory, {
    ...manifest,
    recordingId: payload.recordingId,
    recordingFilePath: path.resolve(payload.recordingFilePath),
    tracks: copiedTracks,
  });
  await rm(sourceDirectory, { recursive: true, force: true });
};

export const loadRecordingParticipantTracks = async (
  recordingId: string,
  _recordingFilePath: string,
): Promise<PersistedParticipantTrack[] | undefined> => {
  for (const directory of completedDirectories(recordingId)) {
    const manifest = await readManifest(directory, "completed");
    // The catalog recording id is stable when the user renames the audio file. Keep identity
    // tracks attached to that id instead of rejecting them because the visible path changed.
    if (manifest.recordingId !== recordingId || manifest.tracks.length === 0) continue;
    const existingNames = new Set(await readdir(directory));
    const tracks = manifest.tracks.filter((track) =>
      existingNames.has(path.basename(track.filePath)),
    );
    if (tracks.length) return tracks;
  }
  return undefined;
};

export const cleanupRecordingParticipantTracks = async (recordingId: string): Promise<void> => {
  await Promise.all(
    completedDirectories(recordingId).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
};
