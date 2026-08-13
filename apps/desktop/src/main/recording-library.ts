import { app } from "electron";

import type { RecordingLibrarySnapshot } from "@private-voice/shared";

import { resolveRecordingDirectory } from "./recording-path";
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

export {
  createRecordingMediaResponse,
  decodeRecordingMediaUrl,
  RECORDING_MEDIA_PROTOCOL,
  toRecordingMediaUrl,
};

export const getRecordingDirectory = (configuredDirectory?: string): string =>
  resolveRecordingDirectory(configuredDirectory, app.getPath("documents"));

export const readRecordingLibrary = async (
  configuredDirectory: string | undefined,
  quotaGb: number,
): Promise<RecordingLibrarySnapshot> => {
  const directory = getRecordingDirectory(configuredDirectory);
  return readRecordingLibraryFromDirectory(directory, quotaGb);
};

export const enforceRecordingQuota = async (
  configuredDirectory: string | undefined,
  quotaGb: number,
): Promise<void> => {
  await enforceRecordingQuotaInDirectory(getRecordingDirectory(configuredDirectory), quotaGb);
};

export const deleteRecording = async (
  configuredDirectory: string | undefined,
  filePath: string,
): Promise<void> => {
  const directory = getRecordingDirectory(configuredDirectory);
  await deleteRecordingInDirectory(directory, filePath);
};

export const setRecordingFavorite = async (
  configuredDirectory: string | undefined,
  filePath: string,
  isFavorite: boolean,
): Promise<void> => {
  await setRecordingFavoriteInDirectory(
    getRecordingDirectory(configuredDirectory),
    filePath,
    isFavorite,
  );
};

export const isAllowedRecordingMediaPath = (
  configuredDirectory: string | undefined,
  filePath: string,
): boolean => {
  const directory = getRecordingDirectory(configuredDirectory);
  return isAllowedRecordingPathInDirectory(directory, filePath);
};
