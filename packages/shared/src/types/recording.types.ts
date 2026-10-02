import { RecordingEncoderState, RecordingState } from "../enums/app.enums";

export interface RecordingOptions {
  targetSampleRate: 48000;
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
  label?: string;
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

export interface RecordingStreamStartPayload {
  sourceMimeType: string;
}

export interface RecordingStreamFinalizePayload {
  sessionId: string;
  sourceMimeType: string;
  sampleRate: number;
  suggestedFileName: string;
  channels: number;
  targetFormat: "m4a-aac";
  durationMs: number;
}

export interface RecordingStreamStartResponse {
  ok: boolean;
  sessionId?: string;
  errorMessage?: string;
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

export interface RecordingSpeakerSegmentPayload {
  sessionId: string;
  buffer: ArrayBuffer;
  sourceMimeType: string;
  speakerId: string;
  displayNameSnapshot: string;
  startMs: number;
  endMs: number;
  userId?: string;
  trackId?: string;
  roomId?: string;
  avatarId?: string;
  joinedAt?: string;
}

export interface RecordingParticipantTrackPayload {
  sessionId: string;
  buffer: ArrayBuffer;
  sourceMimeType: string;
  userId: string;
  speakerId: string;
  displayNameSnapshot: string;
  avatarId?: string;
  trackId: string;
  roomId: string;
  joinedAt?: string;
  startMs: number;
  endMs: number;
}

export interface RecordingParticipantTrackResponse {
  ok: boolean;
  filePath?: string;
  errorMessage?: string;
}

export interface RecordingParticipantTracksFinalizePayload {
  sessionId: string;
  recordingId: string;
  recordingFilePath: string;
}

export interface RecordingSpeakerSegmentResponse {
  ok: boolean;
  filePath?: string;
  errorMessage?: string;
}

export interface RecordingSpeakerSegmentFinalizePayload {
  sessionId: string;
  recordingId: string;
  recordingFilePath: string;
}

export interface RecordingLibraryItem {
  roomName?: string;
  id: string;
  recordingId: string;
  title: string;
  isCustomTitle?: boolean;
  fileName: string;
  filePath: string;
  mediaUrl: string;
  createdAt: string;
  modifiedAt: string;
  fileSize: number;
  roomId?: string;
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
  /** Native scan identity; used to reject files changed after the preview. */
  recordingId?: string;
  fileSize?: number;
  modifiedAt?: string;
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

export interface RecordingAutomaticCleanupResult {
  deletedFilePaths: string[];
  deletedCurrentRecording: boolean;
  wasteDeletedCount: number;
  quotaDeletedCount: number;
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
