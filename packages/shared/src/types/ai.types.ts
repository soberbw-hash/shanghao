export type AiAsrModelId =
  | "qwen3-asr-1.7b-force"
  | "qwen3-asr-0.6b-force"
  | "fun-asr-nano-2512"
  | "glm-asr-nano-2512"
  | "fireredasr2-aed"
  | "paraformer-zh";

export const AI_ASR_MODEL_NAMES: Record<AiAsrModelId, string> = {
  "qwen3-asr-1.7b-force": "Qwen3-ASR-1.7B + ForcedAligner",
  "qwen3-asr-0.6b-force": "Qwen3-ASR-0.6B + ForcedAligner",
  "fun-asr-nano-2512": "Fun-ASR-Nano-2512",
  "glm-asr-nano-2512": "GLM-ASR-Nano-2512",
  "fireredasr2-aed": "FireRedASR2-AED",
  "paraformer-zh": "Paraformer-zh + FSMN-VAD + CT-punc",
};

export type AiSupportModelId = "qwen3-forced-aligner-0.6b";

export type AiModelId = AiAsrModelId | AiSupportModelId | "qwen35-4b";

export type AiModelPhase =
  "not_installed" | "checking" | "downloading" | "paused" | "installed" | "error";

export type AiModelAction = "download" | "pause" | "resume" | "delete";

export type AiProcessingMode = "after_game" | "low_resource" | "immediate" | "manual";

export type AiTextProvider = "cloud" | "local" | "custom";

export interface AiCustomProviderInput {
  baseUrl: string;
  model: string;
  /** Empty keeps the encrypted key that is already stored on this computer. */
  apiKey?: string;
}

export interface AiCustomProviderStatus {
  configured: boolean;
  baseUrl?: string;
  model?: string;
  hasApiKey: boolean;
}

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
  category: "asr" | "support" | "organizer";
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
  /** Shared components required before this model can run. */
  dependencies?: AiSupportModelId[];
  /** Concise hardware warning shown without silently changing the official runtime. */
  hardwareNote?: string;
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
  /** Prevents a resumed recording from mixing transcripts produced by different ASR models. */
  asrModelId?: AiAsrModelId;
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

export interface VoiceMemoryTranscriptionModel {
  id: AiAsrModelId;
  name: string;
  /** Exact downloaded revision used when the runtime reported one. */
  version?: string;
}

export interface VoiceMemoryTranscriptionVariant {
  model: VoiceMemoryTranscriptionModel;
  transcript: VoiceMemoryTranscriptSegment[];
  speakers: VoiceMemorySpeaker[];
  pipelineVersion?: number;
  updatedAt: string;
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
  taskId?: string;
  taskStatus?: VoiceMemoryTaskStatus;
  processingStage?: VoiceMemoryProcessingStage;
  diagnostic?: VoiceMemoryTaskDiagnostic;
  organizedAt?: string;
  /** Recognition pipeline that produced the persisted transcript. Missing means legacy output. */
  transcriptionPipelineVersion?: number;
  /** ASR model that produced this transcript; independent from the model currently selected. */
  transcriptionModel?: VoiceMemoryTranscriptionModel;
  /** Per-model A/B results. The active variant is also mirrored in transcript/speakers. */
  transcriptionVariants?: Partial<Record<AiAsrModelId, VoiceMemoryTranscriptionVariant>>;
  errorMessage?: string;
  speakers: VoiceMemorySpeaker[];
  transcript: VoiceMemoryTranscriptSegment[];
  summary: VoiceMemorySummaryPoint[];
  chapters: VoiceMemoryChapter[];
  highlights: VoiceMemoryHighlight[];
  markerTitles: VoiceMemoryMarkerTitle[];
  timeline: VoiceMemoryTimelineEntry[];
}

export type VoiceMemoryTaskStatus = "pending" | "processing" | "success" | "failed";

export type VoiceMemoryProcessingStage =
  | "recording"
  | "audio_file"
  | "preprocess"
  | "convert"
  | "asr"
  | "transcript"
  | "storage"
  | "organize";

export interface VoiceMemoryTaskDiagnostic {
  taskId: string;
  status: VoiceMemoryTaskStatus;
  stage: VoiceMemoryProcessingStage;
  fileName: string;
  updatedAt: string;
  modelName?: string;
  modelVersion?: string;
  modelPath?: string;
  inputFormat?: string;
  asrInputFormat?: string;
  errorCode?: string;
  errorMessage?: string;
  runtimeMessage?: string;
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
  /** False runs Qwen organization from the saved transcript without invoking ASR again. */
  transcribe?: boolean;
  /** Discard the prior transcript/checkpoint and run recognition again from the beginning. */
  restartTranscription?: boolean;
  /** One-off model choice for A/B testing; does not change the global default. */
  asrModelId?: AiAsrModelId;
  markers?: Array<{ id: string; offsetMs: number }>;
  speakingTimeline?: VoiceMemorySpeakingObservation[];
  taskId?: string;
}

export interface VoiceMemorySpeakingObservation {
  offsetMs: number;
  memberId: string;
  nickname: string;
}

export interface AiAsrRuntimeStatus {
  modelId: AiAsrModelId;
  ready: boolean;
  executable?: string;
  message?: string;
  errorCode?: string;
  outputSource?: "stdout" | "stderr" | "file";
  modelName?: string;
  modelVersion?: string;
  modelPath?: string;
  runtimePhase?:
    "missing" | "stopped" | "preparing" | "loading" | "ready" | "running" | "paused" | "error";
  ffmpegPath?: string;
  asrInputFormat?: string;
}

export interface AiRuntimeStatus {
  /** Runtime selected for new and retried transcriptions. */
  asr: AiAsrRuntimeStatus;
  qwen: {
    ready: boolean;
    executable?: string;
    message?: string;
    errorCode?: string;
    workerPhase?: "stopped" | "starting" | "loading" | "ready" | "running" | "crashed";
    loaded?: boolean;
    processId?: number;
    queuedJobs?: number;
    lastError?: string;
  };
  lastTask?: VoiceMemoryTaskDiagnostic;
}
