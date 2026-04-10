import { RecordingEncoderState, RecordingState } from "../enums/app.enums";

export interface RecordingOptions {
  targetSampleRate: 44100;
  targetFormat: "m4a-aac";
  channels: 1 | 2;
  includeMixedCallAudio: boolean;
}

export interface RecordingResult {
  filePath: string;
  mimeType: string;
  durationMs: number;
  sampleRate: number;
  format: "m4a-aac";
  fileSize: number;
}

export interface RecordingCapability {
  mimeType?: string;
  encoderState: RecordingEncoderState;
  requiresTranscode: boolean;
  supportedMimeTypes: string[];
}

export interface RecordingStatusSnapshot {
  state: RecordingState;
  startedAt?: number;
  durationMs: number;
  message?: string;
  result?: RecordingResult;
}

export interface RecordingExportPayload {
  buffer: ArrayBuffer;
  sourceMimeType: string;
  sampleRate: number;
  suggestedFileName: string;
  channels: number;
  targetFormat: "m4a-aac";
}

export interface RecordingExportResponse {
  ok: boolean;
  filePath?: string;
  keptTemporaryFilePath?: string;
  mimeType?: string;
  fileSize?: number;
  errorMessage?: string;
}
