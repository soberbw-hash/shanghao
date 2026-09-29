import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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
  checkUnindexedAudio = false,
): Promise<ParticipantTrackManifest> => {
  let content: string;
  try {
    content = await readFile(manifestPath(directory), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const entries = await readdir(directory, { withFileTypes: true }).catch(
      (directoryError: NodeJS.ErrnoException) => {
        if (directoryError.code === "ENOENT") return [];
        throw directoryError;
      },
    );
    if (entries.some((entry) => entry.isFile() && /\.(?:webm|m4a|ogg)$/i.test(entry.name))) {
      throw new Error("participant_track_manifest_missing_with_audio", { cause: error });
    }
    return { schemaVersion: 1, sessionId, tracks: [] };
  }
  let parsed: ParticipantTrackManifest;
  try {
    parsed = JSON.parse(content) as ParticipantTrackManifest;
  } catch (error) {
    throw new Error("participant_track_manifest_invalid", { cause: error });
  }
  if (
    !parsed ||
    parsed.schemaVersion !== 1 ||
    typeof parsed.sessionId !== "string" ||
    !Array.isArray(parsed.tracks) ||
    !parsed.tracks.every(
      (track) =>
        track &&
        typeof track.filePath === "string" &&
        typeof track.userId === "string" &&
        typeof track.startMs === "number" &&
        typeof track.endMs === "number",
    )
  ) {
    throw new Error("participant_track_manifest_invalid");
  }
  if (checkUnindexedAudio) {
    const indexedNames = new Set(parsed.tracks.map((track) => path.basename(track.filePath)));
    const entries = await readdir(directory, { withFileTypes: true });
    if (
      entries.some(
        (entry) =>
          entry.isFile() &&
          /\.(?:webm|m4a|ogg)$/i.test(entry.name) &&
          !indexedNames.has(entry.name),
      )
    ) {
      throw new Error("participant_track_unindexed_audio");
    }
  }
  return parsed;
};

const writeManifest = async (
  directory: string,
  manifest: ParticipantTrackManifest,
): Promise<void> => {
  const targetPath = manifestPath(directory);
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(manifest, null, 2), { flag: "wx" });
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
};

const saveParticipantTrackNow = async (
  payload: RecordingParticipantTrackPayload,
): Promise<RecordingParticipantTrackResponse> => {
  try {
    const directory = pendingDirectory(payload.sessionId);
    await mkdir(directory, { recursive: true });
    const manifest = await readManifest(directory, safeId(payload.sessionId), true);
    const index = manifest.tracks.length;
    const startMs = Math.max(0, Math.round(payload.startMs));
    const endMs = Math.max(startMs + 1, Math.round(payload.endMs));
    const filePath = path.join(
      directory,
      `${String(index).padStart(4, "0")}-${safeId(payload.userId)}-${startMs}-${endMs}${extensionForMime(payload.sourceMimeType)}`,
    );
    await writeFile(filePath, Buffer.from(payload.buffer), { flag: "wx" });
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
  const manifest = await readManifest(sourceDirectory, safeId(payload.sessionId), true);
  const previousTarget = await readManifest(targetDirectory, safeId(payload.sessionId), true);
  if (previousTarget.recordingId || previousTarget.tracks.length > 0) {
    throw new Error("participant_track_target_exists");
  }
  const copiedTracks: PersistedParticipantTrack[] = [];
  for (const track of manifest.tracks) {
    const name = path.basename(track.filePath);
    const targetPath = path.join(targetDirectory, name);
    await copyFile(track.filePath, targetPath, constants.COPYFILE_EXCL);
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
