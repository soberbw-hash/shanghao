import { ipcMain, shell, type BrowserWindow } from "electron";
import { IPC_CHANNELS, type AppSettings } from "@private-voice/shared";
import { getUsableRecordingDirectory, scanWasteRecordings } from "./recording-library";
import { recycleUnprotectedRecordingInDirectory } from "./recording-library-core";
import { createRecordingWasteSelection } from "./recording-waste-selection";
import { sendToWindow } from "./safe-web-contents";

export const registerRecordingCleanupIpc = (
  getSettings: () => AppSettings,
  getWindow: () => BrowserWindow | null | undefined,
) => {
  let scannedDirectory: string | undefined;
  const selection = createRecordingWasteSelection(async (candidate) => {
    const directory = await getUsableRecordingDirectory(getSettings().recordingSaveDirectory);
    if (
      directory !== scannedDirectory ||
      !candidate.recordingId ||
      candidate.fileSize === undefined ||
      !candidate.modifiedAt
    ) {
      throw new Error("recording_cleanup_rescan_required");
    }
    await recycleUnprotectedRecordingInDirectory(
      directory,
      candidate.filePath,
      (target) => shell.trashItem(target),
      {
        recordingId: candidate.recordingId,
        fileSize: candidate.fileSize,
        modifiedAt: candidate.modifiedAt,
      },
    );
  });
  ipcMain.handle(IPC_CHANNELS.recording.scanWaste, () =>
    selection.scan(async () => {
      const settings = getSettings();
      scannedDirectory = await getUsableRecordingDirectory(settings.recordingSaveDirectory);
      return scanWasteRecordings(
        scannedDirectory,
        settings.recordingLibraryQuotaGb,
        (processed, total) =>
          sendToWindow(getWindow(), IPC_CHANNELS.recording.scanWasteProgress, { processed, total }),
      );
    }),
  );
  ipcMain.handle(IPC_CHANNELS.recording.cleanWaste, (_event, files: unknown) =>
    selection.clean(files),
  );
};
