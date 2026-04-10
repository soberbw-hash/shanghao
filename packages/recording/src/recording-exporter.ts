import type {
  RecordingExportPayload,
  RecordingExportResponse,
  RecordingResult,
} from "@private-voice/shared";

export interface RecordingExporter {
  exportRecording: (
    payload: RecordingExportPayload,
  ) => Promise<RecordingExportResponse>;
}

export const toRecordingResult = (
  response: RecordingExportResponse,
  mimeType: string,
  durationMs: number,
  sampleRate: number,
): RecordingResult => {
  if (
    !response.ok ||
    !response.filePath ||
    response.fileSize === undefined ||
    !response.mimeType
  ) {
    throw new Error(response.errorMessage ?? "录音导出失败。");
  }

  return {
    filePath: response.filePath,
    mimeType: response.mimeType || mimeType,
    durationMs,
    sampleRate,
    format: "m4a-aac",
    fileSize: response.fileSize,
  };
};
