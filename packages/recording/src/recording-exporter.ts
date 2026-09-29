import type {
  RecordingExportPayload,
  RecordingExportResponse,
  RecordingResult,
} from "@private-voice/shared";

export interface RecordingExporter {
  exportRecording: (payload: RecordingExportPayload) => Promise<RecordingExportResponse>;
}

export interface StreamingRecordingExporter {
  startSession: (payload: { sourceMimeType: string }) => Promise<{
    ok: boolean;
    sessionId?: string;
    errorMessage?: string;
  }>;
  appendChunk: (sessionId: string, buffer: ArrayBuffer) => Promise<void>;
  finalizeSession: (payload: {
    sessionId: string;
    sourceMimeType: string;
    sampleRate: number;
    suggestedFileName: string;
    channels: number;
    targetFormat: "m4a-aac";
    durationMs: number;
  }) => Promise<RecordingExportResponse>;
  /** Closes a failed stream while retaining its temporary bytes for recovery. */
  sealSession?: (sessionId: string) => Promise<void>;
  abortSession: (sessionId: string) => Promise<void>;
}

export const toRecordingResult = (
  response: RecordingExportResponse,
  mimeType: string,
  durationMs: number,
  sampleRate: number,
): RecordingResult => {
  if (!response.ok || !response.filePath || response.fileSize === undefined || !response.mimeType) {
    throw new Error(response.errorMessage ?? "录音导出失败。");
  }

  return {
    recordingId: response.recordingId,
    filePath: response.filePath,
    mimeType: response.mimeType || mimeType,
    durationMs,
    sampleRate,
    format: "m4a-aac",
    fileSize: response.fileSize,
  };
};
