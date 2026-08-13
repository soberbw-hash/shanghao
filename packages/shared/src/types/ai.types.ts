export type AiModelId = "vibevoice" | "qwen35-4b";

export type AiModelPhase =
  "not_installed" | "checking" | "downloading" | "paused" | "installed" | "error";

export type AiModelAction = "download" | "pause" | "resume" | "delete";

export type AiProcessingMode = "after_game" | "low_resource" | "immediate" | "manual";

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
}

export interface AiTaskSchedulerStatus {
  processingMode: AiProcessingMode;
  gameActive: boolean;
  downloadsThrottled: boolean;
  aiTasksPausedForGame: boolean;
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
  updatedAt: string;
}
