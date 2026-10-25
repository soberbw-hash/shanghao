import { app, shell } from "electron";

import type {
  RecordingCleanupScan,
  RecordingLibraryItem,
  RecordingLibrarySnapshot,
} from "@private-voice/shared";

import { resolveRecordingDirectory, resolveUsableRecordingDirectory } from "./recording-path";
import {
  decodeRecordingMediaUrl,
  createRecordingMediaResponse,
  deleteRecordingInDirectory,
  enforceRecordingQuotaInDirectory,
  isAllowedRecordingPathInDirectory,
  readRecordingLibraryFromDirectory,
  recycleUnprotectedRecordingInDirectory,
  renameRecordingInDirectory,
  RECORDING_MEDIA_PROTOCOL,
  setRecordingFavoriteInDirectory,
  toRecordingMediaUrl,
} from "./recording-library-core";
import { inspectRecordingForCleanup } from "./recording-cleanup";
import {
  cleanSilentRecordings,
  type AutomaticRecordingCleanupResult,
} from "./automatic-recording-cleanup";

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
  // Cleanup is a background maintenance task. Decode one file at a time so it
  // does not compete with the renderer, voice processing, or a running game.
  for (let index = 0; index < inspectable.length; index += 1) {
    const item = inspectable[index];
    if (!item) continue;
    const candidate = await inspectRecordingForCleanup(item.filePath).catch(() => undefined);
    if (candidate)
      candidates.push({
        ...candidate,
        recordingId: item.recordingId,
        fileSize: item.fileSize,
        modifiedAt: item.modifiedAt,
      });
    onProgress?.(index + 1, inspectable.length);
  }
  return { candidates, protectedCount: protectedItems.length };
};

export const enforceRecordingQuota = async (
  configuredDirectory: string | undefined,
  quotaGb: number,
): Promise<RecordingLibraryItem[]> =>
  enforceRecordingQuotaInDirectory(await getUsableRecordingDirectory(configuredDirectory), quotaGb);

export type { AutomaticRecordingCleanupResult };

/** Only verified silent recordings are recycled; audible files survive capacity pressure. */
export const runAutomaticRecordingCleanup = async (
  configuredDirectory: string | undefined,
  quotaGb: number,
  cleanWaste: boolean,
  newestFilePath?: string,
): Promise<AutomaticRecordingCleanupResult> => {
  const directory = await getUsableRecordingDirectory(configuredDirectory);
  return cleanSilentRecordings({
    enabled: cleanWaste,
    newestFilePath,
    read: () => readRecordingLibraryFromDirectory(directory, quotaGb),
    inspect: (item) => inspectRecordingForCleanup(item.filePath),
    recycle: (item) =>
      recycleUnprotectedRecordingInDirectory(
        directory,
        item.filePath,
        (target) => shell.trashItem(target),
        {
          recordingId: item.recordingId,
          fileSize: item.fileSize,
          modifiedAt: item.modifiedAt,
        },
      ),
  });
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

export const renameRecording = async (
  configuredDirectory: string | undefined,
  recordingId: string,
  title: string,
  titleMetadata?: Pick<RecordingLibraryItem, "title" | "isCustomTitle">,
): Promise<RecordingLibraryItem> =>
  renameRecordingInDirectory(
    await getUsableRecordingDirectory(configuredDirectory),
    recordingId,
    title,
    titleMetadata,
  );

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
