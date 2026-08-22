import { app } from "electron";

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
  renameRecordingInDirectory,
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
  // Cleanup is a background maintenance task. Decode one file at a time so it
  // does not compete with the renderer, voice processing, or a running game.
  for (let index = 0; index < inspectable.length; index += 1) {
    const item = inspectable[index];
    if (!item) continue;
    const candidate = await inspectRecordingForCleanup(item.filePath).catch(() => undefined);
    if (candidate) candidates.push(candidate);
    onProgress?.(index + 1, inspectable.length);
  }
  return { candidates, protectedCount: protectedItems.length };
};

export const enforceRecordingQuota = async (
  configuredDirectory: string | undefined,
  quotaGb: number,
): Promise<RecordingLibraryItem[]> =>
  enforceRecordingQuotaInDirectory(await getUsableRecordingDirectory(configuredDirectory), quotaGb);

export interface AutomaticRecordingCleanupResult {
  deletedItems: RecordingLibraryItem[];
  wasteDeletedCount: number;
  quotaDeletedCount: number;
}

/** Cleans verified waste first, then applies the storage quota to unprotected oldest files. */
export const runAutomaticRecordingCleanup = async (
  configuredDirectory: string | undefined,
  quotaGb: number,
  cleanWaste: boolean,
  newestFilePath?: string,
): Promise<AutomaticRecordingCleanupResult> => {
  const directory = await getUsableRecordingDirectory(configuredDirectory);
  const deletedItems: RecordingLibraryItem[] = [];
  const deletedPaths = new Set<string>();
  let wasteDeletedCount = 0;

  const deleteItem = async (item: RecordingLibraryItem): Promise<void> => {
    if (deletedPaths.has(item.filePath)) return;
    await deleteRecordingInDirectory(directory, item.filePath);
    deletedPaths.add(item.filePath);
    deletedItems.push(item);
  };

  if (cleanWaste) {
    let snapshot = await readRecordingLibraryFromDirectory(directory, quotaGb);
    const newest = newestFilePath
      ? snapshot.items.find(
          (item) =>
            item.filePath === newestFilePath && !item.isFavorite && item.markers.length === 0,
        )
      : undefined;
    if (newest) {
      const candidate = await inspectRecordingForCleanup(newest.filePath).catch(() => undefined);
      if (candidate) {
        await deleteItem(newest);
        wasteDeletedCount += 1;
      }
    }

    snapshot = await readRecordingLibraryFromDirectory(directory, quotaGb);
    if (snapshot.totalBytes > snapshot.quotaBytes) {
      const scan = await scanWasteRecordings(configuredDirectory, quotaGb);
      const itemsByPath = new Map(snapshot.items.map((item) => [item.filePath, item]));
      for (const candidate of scan.candidates) {
        const item = itemsByPath.get(candidate.filePath);
        if (!item) continue;
        await deleteItem(item).catch(() => undefined);
        if (deletedPaths.has(item.filePath)) wasteDeletedCount += 1;
      }
    }
  }

  const quotaDeleted = await enforceRecordingQuotaInDirectory(directory, quotaGb);
  for (const item of quotaDeleted) {
    if (deletedPaths.has(item.filePath)) continue;
    deletedPaths.add(item.filePath);
    deletedItems.push(item);
  }
  return {
    deletedItems,
    wasteDeletedCount,
    quotaDeletedCount: quotaDeleted.length,
  };
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
): Promise<RecordingLibraryItem> =>
  renameRecordingInDirectory(
    await getUsableRecordingDirectory(configuredDirectory),
    recordingId,
    title,
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
