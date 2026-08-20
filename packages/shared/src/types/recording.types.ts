import { RecordingEncoderState, RecordingState } from "../enums/app.enums";

export interface RecordingOptions {
  targetSampleRate: 44100;
  targetFormat: "m4a-aac";
  channels: 1 | 2;
  includeMixedCallAudio: boolean;
}

export interface RecordingResult {
  recordingId?: string;
  filePath: string;
  mimeType: string;
  durationMs: number;
  sampleRate: number;
  format: "m4a-aac";
  fileSize: number;
}

export interface RecordingMarker {
  id: string;
  offsetMs: number;
  createdAt: string;
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
  recordingId?: string;
  filePath?: string;
  keptTemporaryFilePath?: string;
  mimeType?: string;
  fileSize?: number;
  errorMessage?: string;
}

export interface RecordingLibraryItem {
  id: string;
  recordingId: string;
  title: string;
  fileName: string;
  filePath: string;
  mediaUrl: string;
  createdAt: string;
  modifiedAt: string;
  fileSize: number;
  roomId?: "main" | "side";
  isFavorite: boolean;
  markers: RecordingMarker[];
}

export interface RecordingLibrarySnapshot {
  directory: string;
  totalBytes: number;
  quotaBytes: number;
  items: RecordingLibraryItem[];
}

export type RecordingCleanupReason = "too_short" | "silent" | "unreadable";

export interface RecordingCleanupCandidate {
  filePath: string;
  reason: RecordingCleanupReason;
  durationMs?: number;
}

export interface RecordingCleanupScan {
  candidates: RecordingCleanupCandidate[];
  /** Favorites and recordings with markers are never offered for bulk deletion. */
  protectedCount: number;
}

export interface RecordingCleanupProgress {
  processed: number;
  total: number;
}

export interface RecordingBatchDeleteResult {
  deletedFilePaths: string[];
  failed: Array<{ filePath: string; message: string }>;
}

export interface RecordingRenameResult {
  recordingId: string;
  title: string;
  fileName: string;
  filePath: string;
  mediaUrl: string;
}
