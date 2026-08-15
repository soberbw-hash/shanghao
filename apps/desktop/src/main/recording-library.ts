import { app } from "electron";

import type { RecordingCleanupScan, RecordingLibrarySnapshot } from "@private-voice/shared";

import { resolveRecordingDirectory, resolveUsableRecordingDirectory } from "./recording-path";
import {
  decodeRecordingMediaUrl,
  createRecordingMediaResponse,
  deleteRecordingInDirectory,
  enforceRecordingQuotaInDirectory,
  isAllowedRecordingPathInDirectory,
  readRecordingLibraryFromDirectory,
  RECORDING_MEDIA_PROTOCOL,
  setRecordingFavoriteInDirectory,
  toRecordingMediaUrl,
} from "./recording-library-core";
import { inspectRecordingForCleanup } from "./recording-cleanup";

export {
  createRecordingMediaResponse,
  decodeRecordingMediaUrl,
  RECORDING_MEDIA_PROTOCOL,
  toRecordingMediaUrl,
};

export const getRecordingDirectory = (configuredDirectory?: string): string =>
  resolveRecordingDirectory(configuredDirectory, app.getPath("documents"));

export const getUsableRecordingDirectory = (configuredDirectory?: string): Promise<string> =>
  resolveUsableRecordingDirectory(configuredDirectory, app.getPath("documents"));

export const readRecordingLibrary = async (
  configuredDirectory: string | undefined,
  quotaGb: number,
): Promise<RecordingLibrarySnapshot> => {
  const directory = await getUsableRecordingDirectory(configuredDirectory);
  return readRecordingLibraryFromDirectory(directory, quotaGb);
};

export const scanWasteRecordings = async (
  configuredDirectory: string | undefined,
  quotaGb: number,
  onProgress?: (processed: number, total: number) => void,
): Promise<RecordingCleanupScan> => {
  const library = await readRecordingLibrary(configuredDirectory, quotaGb);
  const protectedItems = library.items.filter((item) => item.isFavorite || item.markers.length > 0);
  const inspectable = library.items.filter((item) => !item.isFavorite && item.markers.length === 0);
  const candidates: RecordingCleanupScan["candidates"] = [];
  onProgress?.(0, inspectable.length);
  for (let index = 0; index < inspectable.length; index += 2) {
    const batch = await Promise.all(
      inspectable
        .slice(index, index + 2)
        .map((item) => inspectRecordingForCleanup(item.filePath).catch(() => undefined)),
    );
    candidates.push(...batch.filter((item) => item !== undefined));
    onProgress?.(Math.min(inspectable.length, index + batch.length), inspectable.length);
  }
  return { candidates, protectedCount: protectedItems.length };
};

export const enforceRecordingQuota = async (
  configuredDirectory: string | undefined,
  quotaGb: number,
): Promise<void> => {
  await enforceRecordingQuotaInDirectory(
    await getUsableRecordingDirectory(configuredDirectory),
    quotaGb,
  );
};

export const deleteRecording = async (
  configuredDirectory: string | undefined,
  filePath: string,
): Promise<void> => {
  const directory = await getUsableRecordingDirectory(configuredDirectory);
  await deleteRecordingInDirectory(directory, filePath);
};

export const setRecordingFavorite = async (
  configuredDirectory: string | undefined,
  filePath: string,
  isFavorite: boolean,
): Promise<void> => {
  await setRecordingFavoriteInDirectory(
    await getUsableRecordingDirectory(configuredDirectory),
    filePath,
    isFavorite,
  );
};

export const isAllowedRecordingMediaPath = (
  configuredDirectory: string | undefined,
  filePath: string,
): boolean => {
  const preferredDirectory = getRecordingDirectory(configuredDirectory);
  const fallbackDirectory = getRecordingDirectory(undefined);
  return [preferredDirectory, fallbackDirectory].some((directory) =>
    isAllowedRecordingPathInDirectory(directory, filePath),
  );
};
