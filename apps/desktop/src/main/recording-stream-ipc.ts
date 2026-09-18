import { ipcMain } from "electron";

import {
  IPC_CHANNELS,
  type AppSettings,
  type RecordingExportPayload,
  type RecordingExportResponse,
  type RecordingStreamFinalizePayload,
  type RecordingStreamStartPayload,
} from "@private-voice/shared";

import {
  abortRecordingSession,
  appendRecordingChunk,
  finalizeRecordingSession,
  startRecordingSession,
} from "./recording-main";
import { exportRecordingFromMain } from "./recording-main";

interface RecordingStreamIpcOptions {
  getSettings: () => Pick<AppSettings, "recordingSaveDirectory">;
  writeLog: Parameters<typeof finalizeRecordingSession>[2];
}

export const registerRecordingStreamIpcHandlers = ({
  getSettings,
  writeLog,
}: RecordingStreamIpcOptions): void => {
  ipcMain.handle(
    IPC_CHANNELS.recording.export,
    async (_event, payload: RecordingExportPayload): Promise<RecordingExportResponse> =>
      exportRecordingFromMain(payload, getSettings().recordingSaveDirectory, writeLog),
  );
  ipcMain.handle(
    IPC_CHANNELS.recording.startSession,
    async (_event, payload: RecordingStreamStartPayload) =>
      startRecordingSession(requireString(payload?.sourceMimeType, 160, "recording_source_mime")),
  );
  ipcMain.handle(
    IPC_CHANNELS.recording.appendChunk,
    async (_event, sessionId: unknown, buffer: unknown): Promise<void> => {
      if (!(buffer instanceof ArrayBuffer)) throw new Error("invalid_recording_chunk");
      await appendRecordingChunk(requireString(sessionId, 80, "recording_session_id"), buffer);
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.recording.finalizeSession,
    async (_event, payload: RecordingStreamFinalizePayload): Promise<RecordingExportResponse> => {
      if (!payload || typeof payload !== "object") throw new Error("invalid_recording_finalize");
      return finalizeRecordingSession(
        {
          ...payload,
          sessionId: requireString(payload.sessionId, 80, "recording_session_id"),
          sourceMimeType: requireString(payload.sourceMimeType, 160, "recording_source_mime"),
          suggestedFileName: requireString(payload.suggestedFileName, 240, "recording_file_name"),
        },
        getSettings().recordingSaveDirectory,
        writeLog,
      );
    },
  );
  ipcMain.handle(IPC_CHANNELS.recording.abortSession, async (_event, sessionId: unknown) => {
    await abortRecordingSession(requireString(sessionId, 80, "recording_session_id"));
  });
};

const requireString = (value: unknown, maximumLength: number, field: string): string => {
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength) {
    throw new Error(`invalid_${field}`);
  }
  return value;
};
