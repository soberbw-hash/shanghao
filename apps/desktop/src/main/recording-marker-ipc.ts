import { app, ipcMain } from "electron";
import path from "node:path";

import { IPC_CHANNELS, type RecordingMarker } from "@private-voice/shared";

import { writePrivateFileAtomically } from "./atomic-private-file";
import {
  requireRecordingFileInDirectory,
  requireRecordingMarkerOffsets,
} from "./recording-ipc-validation";
import { resolveUsableRecordingDirectory } from "./recording-path";
import { SettingsStore } from "./settings-store";

const formatOffset = (offsetMs: number): string => {
  const totalSeconds = Math.max(0, Math.round(offsetMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
};

export const registerRecordingMarkerIpcHandler = (settingsStore: SettingsStore): void => {
  ipcMain.handle(
    IPC_CHANNELS.recording.saveMarkers,
    async (_event, filePath: string, markers: RecordingMarker[]): Promise<string> => {
      const settings = settingsStore.getSnapshot();
      const directory = await resolveUsableRecordingDirectory(
        settings.recordingSaveDirectory,
        app.getPath("documents"),
      );
      const recordingPath = await requireRecordingFileInDirectory(directory, filePath);
      const offsets = requireRecordingMarkerOffsets(markers);
      const parsedPath = path.parse(recordingPath);
      const markerPath = path.join(parsedPath.dir, `${parsedPath.name}-精彩时刻.txt`);
      const content = [
        "上号录音 · 精彩时刻",
        `录音文件：${path.basename(recordingPath)}`,
        "",
        ...offsets.map((offset, index) => `${index + 1}. ${formatOffset(offset)}`),
        "",
        "打开录音并跳到对应时间即可回看。",
      ].join("\r\n");
      await writePrivateFileAtomically(markerPath, Buffer.from(content, "utf8"));
      return markerPath;
    },
  );
};
