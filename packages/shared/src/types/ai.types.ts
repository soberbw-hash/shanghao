export type AiModelId = "vibevoice" | "qwen35-4b";

export type AiModelPhase =
  "not_installed" | "checking" | "downloading" | "paused" | "installed" | "error";

export type AiModelAction = "download" | "pause" | "resume" | "delete";

export type AiProcessingMode = "after_game" | "low_resource" | "immediate" | "manual";

export interface AiRuntimePressure {
  inVoiceRoom: boolean;
  screenSharing: boolean;
  peerRecovering: boolean;
  latencyMs: number;
  packetLossPercent: number;
  rendererMemoryPressure: boolean;
  updatedAt: number;
}

export interface AiModelStatus {
  id: AiModelId;
  name: string;
  purpose: string;
  repository: string;
  approximateBytes: number;
  phase: AiModelPhase;
  userInstalled: boolean;
  activeRevision?: string;
  pendingRevision?: string;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  bytesPerSecond?: number;
  errorMessage?: string;
  updateInProgress: boolean;
  runtimeReady: boolean;
  runtimeMessage?: string;
}

export interface AiTaskSchedulerStatus {
  processingMode: AiProcessingMode;
  gameActive: boolean;
  downloadsThrottled: boolean;
  aiTasksPausedForGame: boolean;
  realtimePressureHigh: boolean;
  pressureReason?: string;
  qwenLoaded: boolean;
  queuedTasks: number;
  runningTask?: string;
}

export interface AiVoiceMemorySnapshot {
  models: AiModelStatus[];
  scheduler: AiTaskSchedulerStatus;
  checkedAt: string;
}

export type AiTaskKind =
  "transcription" | "summary" | "chapters" | "question" | "highlights" | "marker_titles";

export interface AiTaskCheckpoint {
  taskId: string;
  recordingId: string;
  kind: AiTaskKind;
  completedUnits: number;
  totalUnits: number;
  unitDurationMs?: number;
  /** Invalidates partial results when the local inference pipeline changes incompatibly. */
  pipelineVersion?: number;
  updatedAt: string;
}

export type AiConfidence = "high" | "medium" | "pending";

export interface VoiceMemorySpeaker {
  speakerId: string;
  memberId?: string;
  nickname?: string;
  confidence: AiConfidence;
  manuallyConfirmed?: boolean;
}

export interface VoiceMemoryTranscriptSegment {
  id: string;
  recordingId: string;
  startMs: number;
  endMs: number;
  text: string;
  speakerId: string;
  memberId?: string;
  nickname?: string;
  confidence: AiConfidence;
}

export interface VoiceMemoryChapter {
  id: string;
  startMs: number;
  title: string;
  description?: string;
}

export interface VoiceMemoryHighlight {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  description: string;
  transcriptSegmentIds: string[];
  exportable: boolean;
}

export interface VoiceMemoryMarkerTitle {
  markerId: string;
  offsetMs: number;
  title: string;
  userEdited?: boolean;
}

export type VoiceMemoryTimelineKind =
  | "marker"
  | "chapter"
  | "highlight"
  | "member_joined"
  | "member_left"
  | "game_changed"
  | "screen_share_started"
  | "screen_share_stopped";

export interface VoiceMemoryTimelineEntry {
  id: string;
  kind: VoiceMemoryTimelineKind;
  offsetMs: number;
  endMs?: number;
  title: string;
  detail?: string;
}

export interface VoiceMemorySummaryPoint {
  text: string;
  sourceStartMs?: number;
  sourceSegmentIds?: string[];
}

export interface VoiceMemoryRecord {
  schemaVersion: 1;
  recordingId: string;
  filePath: string;
  roomId?: string;
  roomName?: string;
  createdAt: string;
  updatedAt: string;
  phase: "idle" | "transcribing" | "organizing" | "ready" | "paused" | "error";
  progress: number;
  /** Recognition pipeline that produced the persisted transcript. Missing means legacy output. */
  transcriptionPipelineVersion?: number;
  errorMessage?: string;
  speakers: VoiceMemorySpeaker[];
  transcript: VoiceMemoryTranscriptSegment[];
  summary: VoiceMemorySummaryPoint[];
  chapters: VoiceMemoryChapter[];
  highlights: VoiceMemoryHighlight[];
  markerTitles: VoiceMemoryMarkerTitle[];
  timeline: VoiceMemoryTimelineEntry[];
}

export interface VoiceMemoryQuestionRequest {
  recordingId: string;
  question: string;
}

export interface VoiceMemoryGlobalQuestionRequest {
  question: string;
}

export interface VoiceMemoryAnswer {
  text: string;
  sources: Array<{
    startMs: number;
    segmentId: string;
    quote: string;
    recordingId?: string;
    filePath?: string;
    roomName?: string;
    createdAt?: string;
  }>;
}

export interface VoiceMemorySearchRequest {
  query: string;
  nickname?: string;
  roomId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface VoiceMemorySearchResult {
  recordingId: string;
  filePath: string;
  roomName?: string;
  createdAt: string;
  startMs: number;
  title: string;
  excerpt: string;
  score: number;
  kind: "transcript" | "chapter" | "marker" | "highlight";
}

export interface VoiceMemoryProcessRequest {
  recordingId: string;
  filePath: string;
  roomId?: string;
  roomName?: string;
  manual?: boolean;
  organize?: boolean;
  /** Discard the prior transcript/checkpoint and run recognition again from the beginning. */
  restartTranscription?: boolean;
  markers?: Array<{ id: string; offsetMs: number }>;
  speakingTimeline?: VoiceMemorySpeakingObservation[];
}

export interface VoiceMemorySpeakingObservation {
  offsetMs: number;
  memberId: string;
  nickname: string;
}

export interface AiRuntimeStatus {
  vibevoice: { ready: boolean; executable?: string; message?: string };
  qwen: { ready: boolean; executable?: string; message?: string };
}
