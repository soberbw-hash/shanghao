import { ipcMain, shell } from "electron";

import { IPC_CHANNELS } from "@private-voice/shared";

import { getUsableRecordingDirectory } from "./recording-library";
import { resolveRecordingPathForLocation } from "./recording-location";
import { SettingsStore } from "./settings-store";

const requireRecordingPath = (value: unknown): string => {
  if (typeof value !== "string" || value.length > 2_048) {
    throw new Error("invalid_recording_file_path");
  }
  return value;
};

export const registerRecordingLocationIpcHandlers = (settingsStore: SettingsStore): void => {
  ipcMain.handle(IPC_CHANNELS.recording.openDirectory, async (): Promise<void> => {
    const directory = await getUsableRecordingDirectory(
      settingsStore.getSnapshot().recordingSaveDirectory,
    );
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });

  ipcMain.handle(
    IPC_CHANNELS.recording.showItemInFolder,
    async (_event, filePath: string): Promise<void> => {
      const recordingPath = requireRecordingPath(filePath);
      const settings = settingsStore.getSnapshot();
      const directory = await getUsableRecordingDirectory(settings.recordingSaveDirectory);
      const resolvedPath = await resolveRecordingPathForLocation(directory, recordingPath);
      shell.showItemInFolder(resolvedPath);
    },
  );
};
