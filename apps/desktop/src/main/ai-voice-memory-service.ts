import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  AI_ASR_MODEL_NAMES,
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  evaluateVoiceMemoryTranscriptionValidity,
  hasInvalidVoiceMemoryResult,
  mergeTranscriptIntoSentences,
  type AiAsrModelId,
  type AiModelId,
  type AiRuntimeStatus,
  type RendererLogPayload,
  type VoiceMemoryAnswer,
  type VoiceMemoryBenchmarkRunMetadata,
  type VoiceMemoryGlobalQuestionRequest,
  type VoiceMemoryOrganizationPublication,
  type VoiceMemoryProcessRequest,
  type VoiceMemoryQuestionRequest,
  type VoiceMemoryRecord,
  type VoiceMemorySummary,
  type VoiceMemorySearchRequest,
  type VoiceMemorySearchResult,
  type VoiceMemoryProcessingStage,
  type VoiceMemoryTaskDiagnostic,
  type VoiceMemoryTaskStatus,
} from "@private-voice/shared";

import { AiModelManager } from "./ai-model-manager";
import { AiJobWriteOwnership } from "./ai-job-write-ownership";
import { AiRuntimeManager } from "./ai-runtime-manager";
import { transcribeChunkWithRetry } from "./voice-memory-transcription-retry";
import { TRANSCRIPTION_CHUNK_MS, transcriptionChunkMsForModel } from "./asr-chunk-policy";
import { classifyLocalModelRuntimeError } from "./local-model-runtime";
import { VoiceMemoryStore, type VoiceMemorySaveOptions } from "./voice-memory-store";
import { markVoiceMemoryPublication } from "./voice-memory-publication";
import { createEmptyVoiceMemoryRecord as emptyRecord } from "./voice-memory-record";
import { applySpeakingTimeline } from "./voice-memory-observation";
import {
  createTranscriptionUnits,
  statsFromTranscriptionUnits,
} from "./voice-memory-transcription-units";
import { resolveFfmpegExecutable } from "./media-runtime";
import { AiTextGateway } from "./ai-text-gateway";
import {
  ASSISTANT_ANSWER_STYLE,
  assistantAnswerText,
  roomQuestionPrompt,
} from "./voice-memory-question-prompt";
import { VoiceMemoryOrganizer } from "./voice-memory-organizer";
export { transcriptForPrompt } from "./voice-memory-organizer";
import { bindTranscriptToKnownSpeaker, mergeSpeakerTranscript } from "./speaker-transcript";

export {
  TRANSCRIPTION_CHUNK_MS,
  MOSS_CPP_TRANSCRIPTION_CHUNK_MS,
  mossTranscriptionChunkMsForResume,
} from "./asr-chunk-policy";
export { applySpeakingTimeline } from "./voice-memory-observation";
export {
  createTranscriptionUnits,
  statsFromTranscriptionUnits,
  type TranscriptionUnitDefinition,
} from "./voice-memory-transcription-units";
import {
  canAutomaticallyTranscribeDuration,
  completedTranscriptionUnits,
  isRecoverableFfmpegFailure,
  prepareTranscriptionInput,
  prepareKnownSpeakerSources,
  resolveTranscriptionRunRange,
} from "./voice-memory-transcription-preparation";
export {
  AUTOMATIC_TRANSCRIPTION_MAX_DURATION_MS,
  benchmarkDurationForMode,
  benchmarkRangeForMode,
  canAutomaticallyTranscribeDuration,
  completedTranscriptionUnits,
  isRecoverableFfmpegFailure,
  resolveTranscriptionRunRange,
  transcriptionModelMetadata,
} from "./voice-memory-transcription-preparation";
export { isFatalTranscriptionRuntimeFailure } from "./voice-memory-transcription-retry";
const TRANSCRIPTION_PIPELINE_VERSION = CURRENT_TRANSCRIPTION_PIPELINE_VERSION;
const createTaskId = (recordingId: string): string =>
  `voice-memory:${recordingId}:${Date.now()}-${randomUUID().slice(0, 8)}`;

/** Runs resumable transcription and organization while persisting every completed unit. */
export class AiVoiceMemoryService {
  private readonly listeners = new Set<(record: VoiceMemoryRecord) => void>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly pendingProcesses = new Map<string, Promise<VoiceMemoryRecord>>();
  private readonly requestVersions = new Map<string, number>();
  private readonly recordingSetupQueues = new Map<string, Promise<void>>();
  private readonly clearingRecordings = new Set<string>();
  private readonly deletingRecordings = new Set<string>();
  private readonly writeOwnership = new AiJobWriteOwnership();
  private readonly deletedRecordings = new Set<string>();
  private processingQueue: Promise<void> = Promise.resolve();
  private manualQueue: Promise<void> = Promise.resolve();
  private manualRequestVersion = 0;
  private activeManual?: {
    recordingId: string;
    operation: Promise<VoiceMemoryRecord>;
  };
  private activeAutomatic?: {
    recordingId: string;
    operation: Promise<VoiceMemoryRecord>;
    organizing: boolean;
  };
  private activeQuestionController?: AbortController;
  private lastTask?: VoiceMemoryTaskDiagnostic;
  private deferredRetryTimer?: NodeJS.Timeout;
  private unsubscribeModelStatus?: () => void;
  private stopped = false;

  constructor(
    private readonly models: AiModelManager,
    private readonly runtime: AiRuntimeManager,
    private readonly textGateway: AiTextGateway,
    private readonly store: VoiceMemoryStore,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
    private readonly isAutomaticTranscriptionEnabled: () => boolean = () => true,
  ) {}

  async initialize(): Promise<void> {
    if (this.stopped) return;
    await this.store.initialize();
    const records = await this.store.list();
    this.lastTask = records
      .filter((record) => record.diagnostic)
      .sort((left, right) =>
        (right.diagnostic?.updatedAt ?? "").localeCompare(left.diagnostic?.updatedAt ?? ""),
      )[0]?.diagnostic;
    const recoverableFfmpegFailures = records.filter(isRecoverableFfmpegFailure);
    if (recoverableFfmpegFailures.length > 0 && resolveFfmpegExecutable()) {
      for (const record of recoverableFfmpegFailures) {
        await this.save({
          ...record,
          phase: "paused",
          taskStatus: "pending",
          processingStage: "preprocess",
          diagnostic: record.diagnostic
            ? {
                ...record.diagnostic,
                status: "pending",
                updatedAt: new Date().toISOString(),
                errorCode: undefined,
                errorMessage: undefined,
              }
            : undefined,
          errorMessage: undefined,
        });
      }
      this.log("info", "Recoverable FFmpeg voice-memory failures reset", {
        recordingIds: recoverableFfmpegFailures.map((record) => record.recordingId),
      });
    }
    const interrupted = records.filter(
      (record) =>
        record.phase === "transcribing" ||
        record.phase === "organizing" ||
        record.transcriptionUnits?.some((unit) => unit.status === "running") ||
        record.organization?.status === "running" ||
        record.organization?.chunks.some((chunk) => chunk.status === "running"),
    );
    for (const record of interrupted) {
      await this.save({
        ...record,
        transcriptionUnits: record.transcriptionUnits?.map((unit) =>
          unit.status === "running"
            ? {
                ...unit,
                status: "pending",
                stage: undefined,
                heartbeatAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }
            : unit,
        ),
        organization: record.organization
          ? {
              ...record.organization,
              status: record.organization.status === "completed" ? "completed" : "paused",
              chunks: record.organization.chunks.map((chunk) =>
                chunk.status === "running"
                  ? { ...chunk, status: "pending", updatedAt: new Date().toISOString() }
                  : chunk,
              ),
              metrics: record.organization.metrics
                ? { ...record.organization.metrics, interrupted: true }
                : record.organization.metrics,
              updatedAt: new Date().toISOString(),
            }
          : undefined,
        phase: "paused",
        taskStatus: "pending",
        diagnostic: record.diagnostic
          ? {
              ...record.diagnostic,
              status: "pending",
              updatedAt: new Date().toISOString(),
              errorMessage: undefined,
            }
          : undefined,
        errorMessage: undefined,
      });
    }
    if (this.stopped) return;
    this.unsubscribeModelStatus?.();
    this.unsubscribeModelStatus = this.models.onStatus(() => this.scheduleDeferredRetry());
    this.scheduleDeferredRetry();
  }

  onStatus(listener: (record: VoiceMemoryRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getRuntimeStatus(): Promise<AiRuntimeStatus> {
    // CUDA/PyTorch discovery is deliberately lazy. Starting the desktop app in manual
    // transcription mode must not launch a Python worker just to populate the AI settings UI.
    await this.refreshRuntimeStatus();
    const status = await this.runtime.status();
    return { ...status, lastTask: this.lastTask };
  }

  async get(recordingId: string): Promise<VoiceMemoryRecord | undefined> {
    const record = await this.store.get(recordingId);
    return record ? this.withTranscriptionModel(record) : undefined;
  }

  async list(): Promise<VoiceMemoryRecord[]> {
    return (await this.store.list()).map((record) => this.withTranscriptionModel(record));
  }

  async listSummaries(): Promise<VoiceMemorySummary[]> {
    return this.store.listSummaries();
  }

  search(request: VoiceMemorySearchRequest): VoiceMemorySearchResult[] {
    return this.store.search(request);
  }

  pause(recordingId: string): void {
    this.controllers.get(recordingId)?.abort();
  }

  hasActiveTask(): boolean {
    return Boolean(
      this.activeManual ||
      this.activeAutomatic ||
      this.pendingProcesses.size > 0 ||
      [...this.controllers.values()].some((controller) => !controller.signal.aborted),
    );
  }

  pauseAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  /** Ends admission and observation; active jobs keep their existing pause/checkpoint path. */
  stop(): void {
    this.stopped = true;
    if (this.deferredRetryTimer) clearTimeout(this.deferredRetryTimer);
    this.deferredRetryTimer = undefined;
    this.unsubscribeModelStatus?.();
    this.unsubscribeModelStatus = undefined;
    this.pauseAll();
    this.activeQuestionController?.abort();
    this.listeners.clear();
  }

  private serializeRecordingSetup<T>(recordingId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.recordingSetupQueues.get(recordingId) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.recordingSetupQueues.set(recordingId, settled);
    void settled.then(() => {
      if (this.recordingSetupQueues.get(recordingId) === settled) {
        this.recordingSetupQueues.delete(recordingId);
      }
    });
    return result;
  }

  /** Clears one comparison run without deleting the recording file or its user markers. */
  async clearTranscriptionResults(recordingId: string): Promise<VoiceMemoryRecord> {
    if (this.deletingRecordings.has(recordingId)) throw new Error("voice_memory_deleted");
    return this.serializeRecordingSetup(recordingId, async () => {
      this.clearingRecordings.add(recordingId);
      try {
        return await this.clearTranscriptionResultsNow(recordingId);
      } finally {
        this.clearingRecordings.delete(recordingId);
      }
    });
  }

  private async clearTranscriptionResultsNow(recordingId: string): Promise<VoiceMemoryRecord> {
    if (this.pendingProcesses.has(recordingId)) throw new Error("voice_memory_task_active");
    const record = await this.requireRecord(recordingId);
    this.requestVersions.set(recordingId, (this.requestVersions.get(recordingId) ?? 0) + 1);
    this.controllers.delete(recordingId);
    await Promise.all([
      ...Object.keys(AI_ASR_MODEL_NAMES).map((modelId) =>
        this.models.clearTaskCheckpoint(`transcription:${recordingId}:${modelId}`),
      ),
      this.models.clearTaskCheckpoint(`transcription:${recordingId}`),
    ]);
    if (this.lastTask?.taskId.includes(recordingId)) this.lastTask = undefined;
    return this.save(
      {
        ...record,
        phase: "idle",
        progress: 0,
        taskId: undefined,
        taskStatus: undefined,
        processingStage: undefined,
        diagnostic: undefined,
        organizedAt: undefined,
        transcriptionPipelineVersion: undefined,
        transcriptionModel: undefined,
        transcriptionVariants: undefined,
        transcriptionElapsedMs: undefined,
        transcriptionStats: undefined,
        transcriptionUnits: undefined,
        transcriptionBenchmark: undefined,
        errorMessage: undefined,
        speakers: [],
        transcript: [],
        summary: [],
        chapters: [],
        highlights: [],
        timeline: record.timeline.filter((entry) => entry.kind === "marker"),
        organization: undefined,
        organizationPublication: undefined,
      },
      { clearTranscriptionEvents: true },
    );
  }

  async markOrganizationPublished(
    recordingId: string,
    publication: VoiceMemoryOrganizationPublication,
    organizedAt?: string,
  ): Promise<VoiceMemoryRecord> {
    return markVoiceMemoryPublication(
      recordingId,
      publication,
      organizedAt,
      (id) => this.requireRecord(id),
      (record, options) => this.save(record, options),
    );
  }

  cancelQuestion(): boolean {
    if (!this.activeQuestionController || this.activeQuestionController.signal.aborted)
      return false;
    this.activeQuestionController.abort();
    return true;
  }

  async delete(recordingId: string): Promise<void> {
    this.deletedRecordings.add(recordingId);
    this.deletingRecordings.add(recordingId);
    this.requestVersions.set(recordingId, (this.requestVersions.get(recordingId) ?? 0) + 1);
    this.controllers.get(recordingId)?.abort();
    return this.serializeRecordingSetup(recordingId, async () => {
      try {
        await this.deleteNow(recordingId);
      } finally {
        this.deletingRecordings.delete(recordingId);
      }
    });
  }

  private async deleteNow(recordingId: string): Promise<void> {
    const pending = this.pendingProcesses.get(recordingId);
    if (pending) {
      await Promise.race([
        pending.catch(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
      ]);
    }
    this.pendingProcesses.delete(recordingId);
    this.controllers.delete(recordingId);
    await this.store.delete(recordingId);
    try {
      await this.models.clearTaskCheckpointsForRecording(recordingId);
    } catch {
      // The record is already gone. Do not tell the UI deletion failed and invite a retry
      // that could target a newly imported recording with the same identity.
      this.log("warn", "Voice memory checkpoint cleanup failed", {
        errorCode: "voice_memory_checkpoint_cleanup_failed",
      });
    }
  }

  async reconcileRecordingIdentity(
    legacyRecordingId: string,
    recordingId: string,
    filePath: string,
    markers: Array<{ id: string; offsetMs: number }> = [],
  ): Promise<void> {
    const stable = await this.store.get(recordingId);
    const legacy =
      legacyRecordingId !== recordingId ? await this.store.get(legacyRecordingId) : undefined;
    const record = stable ?? legacy;
    if (!record) return;
    const activeIds = new Set([legacyRecordingId, recordingId]);
    const running = [...activeIds].some((id) => this.pendingProcesses.has(id));
    for (const id of activeIds) {
      this.requestVersions.set(id, (this.requestVersions.get(id) ?? 0) + 1);
      this.controllers.get(id)?.abort();
    }
    await Promise.all(
      [...activeIds].map(async (id) => {
        const pending = this.pendingProcesses.get(id);
        if (!pending) return;
        await Promise.race([
          pending.catch(() => undefined),
          new Promise<void>((resolve) => setTimeout(resolve, 4_000)),
        ]);
      }),
    );
    const migrated = await this.store.save({
      ...record,
      recordingId,
      filePath,
      transcript: record.transcript.map((segment) => ({ ...segment, recordingId })),
      markerTitles: record.markerTitles.map((marker) => {
        const current = markers.find((candidate) => candidate.offsetMs === marker.offsetMs);
        return current ? { ...marker, markerId: current.id } : marker;
      }),
      phase: running ? "paused" : record.phase,
    });
    if (legacy && legacyRecordingId !== recordingId) await this.store.delete(legacyRecordingId);
    if (running) {
      void this.start({
        recordingId,
        filePath,
        roomId: migrated.roomId,
        roomName: migrated.roomName,
        manual: true,
        organize: true,
      });
    }
  }

  async resume(recordingId: string): Promise<VoiceMemoryRecord> {
    const record = await this.store.get(recordingId);
    if (!record) throw new Error("voice_memory_not_found");
    const resumeOrganization =
      record.processingStage === "organize" &&
      record.transcript.length > 0 &&
      !hasInvalidVoiceMemoryResult(record);
    return this.start({
      recordingId,
      filePath: record.filePath,
      roomId: record.roomId,
      roomName: record.roomName,
      manual: true,
      transcribe: !resumeOrganization,
      organize: resumeOrganization,
      asrModelId: record.transcriptionModel?.id,
    });
  }

  async selectTranscriptionVariant(
    recordingId: string,
    modelId: AiAsrModelId,
  ): Promise<VoiceMemoryRecord> {
    const record = await this.requireRecord(recordingId);
    const variant = record.transcriptionVariants?.[modelId];
    if (!variant) throw new Error("voice_memory_transcription_variant_not_found");
    return this.save({
      ...record,
      transcript: variant.transcript,
      speakers: variant.speakers,
      transcriptionModel: variant.model,
      transcriptionPipelineVersion: variant.pipelineVersion,
      transcriptionElapsedMs: variant.transcriptionElapsedMs,
      transcriptionStats: variant.transcriptionStats,
      transcriptionUnits: variant.transcriptionUnits,
      transcriptionBenchmark: variant.benchmark,
      phase: "ready",
      progress: 100,
      errorMessage: undefined,
    });
  }

  /** Acknowledges a UI retry immediately while the durable worker continues in the background. */
  async start(request: VoiceMemoryProcessRequest): Promise<VoiceMemoryRecord> {
    if (this.deletingRecordings.has(request.recordingId)) throw new Error("voice_memory_deleted");
    const allowRecreate = this.deletedRecordings.has(request.recordingId);
    return this.serializeRecordingSetup(request.recordingId, () =>
      this.startNow(request, allowRecreate),
    );
  }

  private async startNow(
    request: VoiceMemoryProcessRequest,
    allowRecreate: boolean,
  ): Promise<VoiceMemoryRecord> {
    if (this.deletedRecordings.has(request.recordingId) && !allowRecreate) {
      throw new Error("voice_memory_deleted");
    }
    if (allowRecreate) this.deletedRecordings.delete(request.recordingId);
    // A retry button can be clicked more than once while the request is waiting
    // behind another long recording. Keep the first accepted task instead of
    // replacing it with another task for the same recording.
    const pending = this.pendingProcesses.get(request.recordingId);
    if (pending) {
      const pendingRecord = await this.store.get(request.recordingId);
      const previousTaskIsTerminal =
        pendingRecord &&
        (pendingRecord.phase === "ready" ||
          pendingRecord.phase === "error" ||
          pendingRecord.phase === "paused") &&
        pendingRecord.taskStatus !== "processing";
      const startsDistinctTask =
        previousTaskIsTerminal &&
        Boolean(request.taskId && request.taskId !== pendingRecord?.taskId);
      if ((!request.restartTranscription && !startsDistinctTask) || !previousTaskIsTerminal) {
        if (pendingRecord) return pendingRecord;
      } else {
        await pending.catch(() => undefined);
        if (this.pendingProcesses.get(request.recordingId) === pending) {
          this.pendingProcesses.delete(request.recordingId);
        }
      }
    }
    const previousRecord = await this.store.get(request.recordingId);
    const previous = previousRecord ? this.withTranscriptionModel(previousRecord) : undefined;
    const taskId = request.taskId ?? createTaskId(request.recordingId);
    const queuedRequest = {
      ...request,
      taskId,
      // A manual retry is a durable resume unless the caller explicitly requests a restart.
      // Invalid/partial results are exactly the records that need their completed units kept.
      restartTranscription: request.transcribe !== false && request.restartTranscription === true,
    };
    const queued = await this.save({
      ...(previous ?? emptyRecord(queuedRequest)),
      recordedAt: request.recordedAt ?? previous?.recordedAt,
      roomId: request.roomId ?? previous?.roomId,
      roomName: request.roomName ?? previous?.roomName,
      phase: "idle",
      taskId,
      taskStatus: "pending",
      processingStage: "recording",
      diagnostic: this.createDiagnostic(queuedRequest, "pending", "recording"),
      errorMessage: undefined,
    });
    if (request.manual) {
      void this.process(queuedRequest).catch(() => undefined);
    } else {
      this.queueAutomaticProcess(queuedRequest);
    }
    return queued;
  }

  process(request: VoiceMemoryProcessRequest): Promise<VoiceMemoryRecord> {
    if (this.stopped) return Promise.reject(new Error("ai_task_paused"));
    if (
      this.clearingRecordings.has(request.recordingId) ||
      this.deletingRecordings.has(request.recordingId)
    ) {
      return Promise.reject(new Error("voice_memory_task_active"));
    }
    request = { ...request, taskId: request.taskId ?? createTaskId(request.recordingId) };
    this.deletedRecordings.delete(request.recordingId);
    const pending = this.pendingProcesses.get(request.recordingId);
    if (pending) {
      if (!request.restartTranscription) return pending;
      this.controllers.get(request.recordingId)?.abort();
      return pending
        .catch(() => undefined)
        .then(() => {
          if (this.pendingProcesses.get(request.recordingId) === pending) {
            this.pendingProcesses.delete(request.recordingId);
          }
          return this.process(request);
        });
    }

    const version = (this.requestVersions.get(request.recordingId) ?? 0) + 1;
    this.requestVersions.set(request.recordingId, version);
    const run = async (): Promise<VoiceMemoryRecord> => {
      if (this.requestVersions.get(request.recordingId) !== version) {
        return (await this.store.get(request.recordingId)) ?? emptyRecord(request);
      }
      return this.writeOwnership.run(request.recordingId, version, () => this.processNow(request));
    };

    let operation: Promise<VoiceMemoryRecord>;
    if (request.manual) {
      const manualRequestVersion = ++this.manualRequestVersion;
      const interruptedAutomatic = this.activeAutomatic?.operation;
      const interruptedManual = this.activeManual?.operation;
      if (this.activeAutomatic) {
        this.controllers.get(this.activeAutomatic.recordingId)?.abort();
      }
      if (this.activeManual) {
        this.controllers.get(this.activeManual.recordingId)?.abort();
      }
      operation = this.manualQueue
        .catch(() => undefined)
        .then(async () => {
          await Promise.all([
            interruptedAutomatic?.catch(() => undefined),
            interruptedManual?.catch(() => undefined),
          ]);
          if (manualRequestVersion !== this.manualRequestVersion) {
            const superseded = (await this.store.get(request.recordingId)) ?? emptyRecord(request);
            return this.save({
              ...superseded,
              phase: "paused",
              taskStatus: "pending",
              processingStage: "recording",
              diagnostic: this.createDiagnostic(request, "pending", "recording", {
                errorCode: "manual_task_superseded",
                errorMessage: "已暂停：已开始另一条录音的转录。",
              }),
              errorMessage: undefined,
            });
          }
          const active = run();
          this.activeManual = { recordingId: request.recordingId, operation: active };
          try {
            return await active;
          } finally {
            if (this.activeManual?.operation === active) this.activeManual = undefined;
          }
        });
      this.manualQueue = operation.then(
        () => undefined,
        () => undefined,
      );
    } else {
      operation = this.processingQueue
        .catch(() => undefined)
        .then(async () => {
          await this.manualQueue.catch(() => undefined);
          if (this.requestVersions.get(request.recordingId) !== version) {
            return (await this.store.get(request.recordingId)) ?? emptyRecord(request);
          }
          const active = run();
          this.activeAutomatic = {
            recordingId: request.recordingId,
            operation: active,
            organizing: request.organize !== false,
          };
          try {
            return await active;
          } finally {
            if (this.activeAutomatic?.operation === active) this.activeAutomatic = undefined;
          }
        });
      this.processingQueue = operation.then(
        () => undefined,
        () => undefined,
      );
    }
    this.pendingProcesses.set(request.recordingId, operation);
    void operation.then(
      () => {
        if (this.pendingProcesses.get(request.recordingId) === operation) {
          this.pendingProcesses.delete(request.recordingId);
        }
      },
      () => {
        if (this.pendingProcesses.get(request.recordingId) === operation) {
          this.pendingProcesses.delete(request.recordingId);
        }
      },
    );
    return operation;
  }

  async queueRecordings(
    recordings: Array<{
      recordingId?: string;
      filePath: string;
      fileSize?: number;
      roomId?: string;
      roomName?: string;
      markers?: Array<{ id: string; offsetMs: number }>;
    }>,
    organize: boolean,
  ): Promise<void> {
    if (!this.isAutomaticTranscriptionEnabled()) return;
    for (const recording of [...recordings].sort(
      (left, right) =>
        (left.fileSize ?? Number.MAX_SAFE_INTEGER) - (right.fileSize ?? Number.MAX_SAFE_INTEGER),
    )) {
      const recordingId = recording.recordingId ?? recording.filePath;
      await this.reconcileRecordingIdentity(
        recording.filePath,
        recordingId,
        recording.filePath,
        recording.markers,
      );
      const record = await this.store.get(recordingId);
      const isCurrentTerminalResult =
        record?.phase === "ready" &&
        record.transcriptionPipelineVersion === TRANSCRIPTION_PIPELINE_VERSION;
      if (isCurrentTerminalResult || this.pendingProcesses.has(recordingId)) continue;
      const taskId = createTaskId(recordingId);
      const queuedRequest: VoiceMemoryProcessRequest = {
        recordingId,
        filePath: recording.filePath,
        roomId: recording.roomId,
        roomName:
          record?.roomName ??
          recording.roomName ??
          (recording.roomId === "side"
            ? "二号房"
            : recording.roomId === "main"
              ? "一号房"
              : "房间"),
        organize,
        markers: recording.markers,
        taskId,
      };
      await this.start(queuedRequest);
    }
  }

  private queueAutomaticProcess(request: VoiceMemoryProcessRequest): void {
    // Readable speech always wins over an optional Qwen summary. If organization is
    // occupying the worker, keep its transcript checkpoint and yield to the new audio.
    if (this.activeAutomatic?.organizing) {
      this.controllers.get(this.activeAutomatic.recordingId)?.abort();
    }
    const transcription = this.process({ ...request, organize: false });
    if (request.organize !== false) {
      void transcription
        .then((record) => {
          if (!record.transcript.length || record.errorMessage === "no_reliable_speech") return;
          return this.process({ ...request, transcribe: false, organize: true });
        })
        .catch(() => undefined);
    } else {
      void transcription.catch(() => undefined);
    }
  }

  private async processNow(request: VoiceMemoryProcessRequest): Promise<VoiceMemoryRecord> {
    if (this.stopped) throw new Error("ai_task_paused");
    const taskId = request.taskId ?? createTaskId(request.recordingId);
    this.log("info", "Voice memory processing started", {
      recordingId: request.recordingId,
      taskId,
      manual: request.manual === true,
      restartTranscription: request.restartTranscription === true,
    });
    const previous = await this.store.get(request.recordingId);
    let record = previous ?? emptyRecord(request);
    if (request.benchmark) {
      const environment = await this.runtime.benchmarkEnvironment();
      const previousBenchmark = previous?.transcriptionBenchmark;
      const preservedClips =
        !request.restartTranscription && previousBenchmark?.mode === request.benchmark.mode
          ? previousBenchmark?.clips
          : undefined;
      record = {
        ...record,
        transcriptionBenchmark: {
          ...request.benchmark,
          clips: request.benchmark.clips ?? preservedClips,
          environment: {
            ...environment,
            ...request.benchmark.environment,
            pipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
            adapterVersion: "desktop-asr-adapter-v1",
          },
        },
      };
    }
    let currentStage: VoiceMemoryProcessingStage = "recording";
    const shouldTranscribe = request.transcribe !== false;
    const controller = new AbortController();
    this.controllers.get(request.recordingId)?.abort();
    this.controllers.set(request.recordingId, controller);
    try {
      if (shouldTranscribe) {
        currentStage = "audio_file";
        await this.runtime.validateInputFile(request.filePath);
        record = await this.updateDiagnostic(record, request, taskId, currentStage, "processing");
        if (request.restartTranscription) {
          const restartModelId =
            request.asrModelId ?? record.transcriptionModel?.id ?? this.models.getActiveAsrModel();
          await Promise.all([
            this.models.clearTaskCheckpoint(
              `transcription:${record.recordingId}:${restartModelId}`,
            ),
            this.models.clearTaskCheckpoint(`transcription:${record.recordingId}`),
          ]);
          record = await this.save({
            ...record,
            phase: "idle",
            progress: 0,
            speakers: [],
            transcript: [],
            summary: [],
            chapters: [],
            highlights: [],
            timeline: record.timeline.filter((entry) => entry.kind === "marker"),
            transcriptionPipelineVersion: undefined,
            transcriptionModel: undefined,
            transcriptionElapsedMs: undefined,
            transcriptionStats: undefined,
            transcriptionUnits: undefined,
            transcriptionBenchmark: request.benchmark ? record.transcriptionBenchmark : undefined,
            organizedAt: undefined,
            organization: undefined,
            organizationPublication: undefined,
            errorMessage: undefined,
          });
        }
        if (!request.benchmark && record.transcriptionBenchmark) {
          // A saved benchmark clip is historical result metadata. A later normal transcription
          // must always use the full recording and must not inherit benchmark-only range/state.
          record = { ...record, transcriptionBenchmark: undefined };
        }
        record = await this.transcribe(
          record,
          request.manual === true,
          controller.signal,
          request.asrModelId,
          request.benchmark,
          (stage) => {
            currentStage = stage;
          },
        );
        record = applySpeakingTimeline(record, request.speakingTimeline ?? []);
      } else if (record.transcript.length === 0 || hasInvalidVoiceMemoryResult(record)) {
        throw new Error("voice_memory_transcript_required");
      }
      if (record.transcript.length === 0) {
        this.log("info", "Voice memory contained no reliable speech", {
          recordingId: record.recordingId,
        });
        const validity = evaluateVoiceMemoryTranscriptionValidity(
          record.transcriptionStats,
          record.transcriptionUnits,
        );
        const partial = !validity.complete;
        const missedSpeech = (record.transcriptionStats?.emptyOutputOnSpeechUnits ?? 0) > 0;
        return this.save({
          ...record,
          phase: "ready",
          progress: 100,
          taskId,
          taskStatus: partial ? "failed" : "success",
          processingStage: "transcript",
          diagnostic: this.createDiagnostic(request, partial ? "failed" : "success", "transcript", {
            errorCode: partial
              ? "partial_transcription"
              : missedSpeech
                ? "empty_output_on_speech"
                : "no_reliable_speech",
            errorMessage: partial
              ? "部分音频分块处理失败，未得到完整转录。"
              : missedSpeech
                ? "公共语音检测发现人声，但模型没有产生有效文字。"
                : "没有检测到可识别的人声。",
          }),
          transcriptionPipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
          errorMessage: partial
            ? "partial_transcription"
            : missedSpeech
              ? "empty_output_on_speech"
              : "no_reliable_speech",
        });
      }
      await this.save({
        ...record,
        taskId,
        taskStatus: "processing",
        processingStage: "transcript",
        transcriptionPipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
      });
      let organizationError: string | undefined;
      if (request.organize !== false) {
        try {
          currentStage = "organize";
          record = await this.organize(record, request.manual === true, controller.signal);
        } catch (error) {
          if (controller.signal.aborted || (error as Error).message === "ai_task_paused")
            throw error;
          organizationError = error instanceof Error ? error.message : String(error);
          // Preserve the durable attempts/failure state saved inside organize before it threw.
          record = (await this.store.get(record.recordingId)) ?? record;
          this.log("warn", "Voice memory organization failed; transcript retained", {
            recordingId: record.recordingId,
            reason: organizationError,
          });
        }
      }
      const transcriptionValidity = evaluateVoiceMemoryTranscriptionValidity(
        record.transcriptionStats,
        record.transcriptionUnits,
      );
      const partialTranscription = !transcriptionValidity.complete;
      record = await this.save({
        ...record,
        phase: "ready",
        progress: 100,
        taskId,
        taskStatus: organizationError || partialTranscription ? "failed" : "success",
        processingStage: organizationError ? "organize" : "storage",
        diagnostic: this.createDiagnostic(
          request,
          organizationError || partialTranscription ? "failed" : "success",
          organizationError ? "organize" : "storage",
          organizationError
            ? { errorMessage: `organize_failed:${organizationError}` }
            : partialTranscription
              ? {
                  errorCode: "partial_transcription",
                  errorMessage: "部分音频分块处理失败，可继续重试失败分块。",
                }
              : undefined,
        ),
        transcriptionPipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
        errorMessage: organizationError
          ? `organize_failed:${organizationError}`
          : partialTranscription
            ? "partial_transcription"
            : undefined,
      });
      this.log("info", "Voice memory processing completed", {
        recordingId: record.recordingId,
        transcriptSegments: record.transcript.length,
      });
      return record;
    } catch (error) {
      const paused = controller.signal.aborted || (error as Error).message === "ai_task_paused";
      const reason = error instanceof Error ? error.message : String(error);
      const requiresManual =
        !request.manual && reason === "automatic_long_recording_requires_manual";
      this.log(paused || requiresManual ? "info" : "error", "Voice memory processing stopped", {
        recordingId: record.recordingId,
        reason,
        paused,
      });
      const deferred =
        !request.manual &&
        !requiresManual &&
        (reason === "manual_only" ||
          reason === "waiting_for_game_to_finish" ||
          reason === "realtime_pressure" ||
          reason.startsWith("voice_") ||
          reason.startsWith("screen_share") ||
          reason.startsWith("peer_recovery") ||
          reason.startsWith("network_quality") ||
          reason.startsWith("renderer_memory"));
      // transcribe() persists every completed chunk before moving to the next one. When a later
      // chunk is paused or fails, the rejected promise cannot return that newer record object to
      // this caller. Reload the durable copy so this final status update never overwrites already
      // visible transcript segments with the stale pre-transcription snapshot.
      const durableRecord = (await this.store.get(request.recordingId)) ?? record;
      const interruptedStats = durableRecord.transcriptionStats
        ? {
            ...durableRecord.transcriptionStats,
            finalResultSaved: false,
            terminationReason: paused ? ("paused" as const) : ("failed" as const),
          }
        : undefined;
      record = await this.save({
        ...durableRecord,
        transcriptionStats: interruptedStats,
        taskId,
        taskStatus: paused || deferred || requiresManual ? "pending" : "failed",
        processingStage: currentStage,
        diagnostic: this.createDiagnostic(
          request,
          paused || deferred || requiresManual ? "pending" : "failed",
          currentStage,
          { errorCode: this.errorCode(error), errorMessage: reason },
        ),
        phase: paused || deferred || requiresManual ? "paused" : "error",
        errorMessage: requiresManual
          ? "manual_required:long_recording"
          : deferred
            ? `deferred:${reason}`
            : paused
              ? undefined
              : reason,
      });
      if (deferred) this.scheduleDeferredRetry();
      if (!paused && !deferred) throw error;
      return record;
    } finally {
      if (this.controllers.get(request.recordingId) === controller) {
        this.controllers.delete(request.recordingId);
      }
      if (request.taskId?.startsWith("model-comparison:")) {
        // A comparison run is intentionally isolated: do not leave the previous model resident
        // while the next model is waiting to load, and do not let a failed run retain its worker.
        this.runtime.releaseAsr("model_comparison_model_complete");
      }
    }
  }

  async assignSpeaker(
    recordingId: string,
    speakerId: string,
    memberId: string,
    nickname: string,
  ): Promise<VoiceMemoryRecord> {
    const record = await this.requireRecord(recordingId);
    const speakers = record.speakers.filter((speaker) => speaker.speakerId !== speakerId);
    speakers.push({ speakerId, memberId, nickname, confidence: "high", manuallyConfirmed: true });
    return this.save({
      ...record,
      speakers,
      transcript: record.transcript.map((segment) =>
        segment.speakerId === speakerId
          ? { ...segment, memberId, nickname, confidence: "high" }
          : segment,
      ),
    });
  }

  async updateMarkerTitle(
    recordingId: string,
    markerId: string,
    title: string,
  ): Promise<VoiceMemoryRecord> {
    const record = await this.requireRecord(recordingId);
    const normalized = title.trim().slice(0, 120);
    if (!normalized) throw new Error("invalid_marker_title");
    return this.save({
      ...record,
      markerTitles: record.markerTitles.map((marker) =>
        marker.markerId === markerId ? { ...marker, title: normalized, userEdited: true } : marker,
      ),
      timeline: record.timeline.map((entry) =>
        entry.kind === "marker" && entry.id === markerId ? { ...entry, title: normalized } : entry,
      ),
    });
  }

  async ask(request: VoiceMemoryQuestionRequest): Promise<VoiceMemoryAnswer> {
    const record = await this.requireRecord(request.recordingId);
    const terms = request.question
      .normalize("NFKC")
      .split(/\s+/)
      .filter((term) => term.length > 1);
    const candidates = record.transcript
      .map((segment) => ({
        segment,
        score: terms.reduce((score, term) => score + (segment.text.includes(term) ? 1 : 0), 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 16)
      .map(({ segment }) => segment);
    const answer = await this.runQuestion((signal) =>
      this.textGateway.generateJson<VoiceMemoryAnswer>({
        roomId: record.roomId,
        purpose: "question",
        manual: true,
        maxNewTokens: 700,
        signal,
        prompt: [
          "你是上号的本地语音记忆助手。只根据给出的录音片段回答朋友间的日常问题。",
          ...ASSISTANT_ANSWER_STYLE,
          '返回 JSON：{"text":"回答","sources":[{"startMs":数字,"segmentId":"id","quote":"简短原话"}]}。没有依据就明确说没找到。',
          `问题：${request.question.slice(0, 500)}`,
          "片段：",
          ...candidates.map(
            (segment) =>
              `${segment.id}\t${segment.startMs}\t${segment.nickname ?? segment.speakerId}\t${segment.text}`,
          ),
        ].join("\n"),
      }),
    );
    return {
      text: assistantAnswerText(answer.text),
      sources: (Array.isArray(answer.sources) ? answer.sources : [])
        .map((source) => {
          const segment = candidates.find((candidate) => candidate.id === source.segmentId);
          return segment
            ? {
                startMs: segment.startMs,
                segmentId: segment.id,
                quote: String(source.quote || segment.text).slice(0, 240),
                recordingId: record.recordingId,
                filePath: record.filePath,
                roomName: record.roomName,
                createdAt: record.createdAt,
              }
            : undefined;
        })
        .filter((source): source is NonNullable<typeof source> => Boolean(source))
        .slice(0, 8),
    };
  }

  async askMemory(request: VoiceMemoryGlobalQuestionRequest): Promise<VoiceMemoryAnswer> {
    const question = request.question.trim().slice(0, 500);
    if (!question) throw new Error("memory_question_required");
    const roomId = this.textGateway.questionRoomId();
    const candidates = roomId ? this.store.related(question, 24, roomId) : [];
    const answer = await this.runQuestion((signal) =>
      this.textGateway.generateJson<VoiceMemoryAnswer>({
        roomId,
        purpose: "question",
        manual: true,
        maxNewTokens: 700,
        signal,
        prompt: roomQuestionPrompt(question, candidates),
      }),
    );
    return {
      text: assistantAnswerText(answer.text),
      sources: (Array.isArray(answer.sources) ? answer.sources : [])
        .map((source) => {
          const match = /^memory-(\d+)$/.exec(source.segmentId);
          const candidate = match
            ? candidates[Number.parseInt(match[1] ?? "0", 10) - 1]
            : undefined;
          return candidate
            ? {
                startMs: candidate.startMs,
                segmentId: source.segmentId,
                quote: String(source.quote || candidate.excerpt).slice(0, 240),
                recordingId: candidate.recordingId,
                filePath: candidate.filePath,
                roomName: candidate.roomName,
                createdAt: candidate.createdAt,
              }
            : undefined;
        })
        .filter((source): source is NonNullable<typeof source> => Boolean(source))
        .slice(0, 8),
    };
  }

  private async transcribe(
    record: VoiceMemoryRecord,
    manual: boolean,
    signal: AbortSignal,
    requestedModelId?: AiAsrModelId,
    requestedBenchmark?: VoiceMemoryBenchmarkRunMetadata,
    onStage?: (stage: VoiceMemoryProcessingStage) => void,
  ): Promise<VoiceMemoryRecord> {
    const started = performance.now();
    const previousElapsed = record.transcriptionStats?.totalElapsedMs ?? 0;
    const result = await this.transcribeCore(
      record,
      manual,
      signal,
      requestedModelId,
      requestedBenchmark,
      onStage,
    );
    if (!requestedBenchmark || !result.transcriptionStats) return result;
    const stats = result.transcriptionStats;
    const totalElapsedMs = previousElapsed + performance.now() - started;
    const known = [
      stats.loadElapsedMs,
      stats.conversionElapsedMs,
      stats.preflightElapsedMs,
      stats.resourceProbeElapsedMs,
      stats.vadElapsedMs,
      stats.inferenceElapsedMs,
      stats.alignmentElapsedMs,
      stats.postprocessElapsedMs,
      stats.mergeElapsedMs,
      stats.saveElapsedMs,
      stats.releaseElapsedMs,
    ].reduce<number>((sum, value) => sum + (value ?? 0), 0);
    return this.save({
      ...result,
      transcriptionStats: {
        ...stats,
        totalElapsedMs,
        unaccountedElapsedMs: Math.max(0, totalElapsedMs - known),
      },
    });
  }

  private async transcribeCore(
    record: VoiceMemoryRecord,
    manual: boolean,
    signal: AbortSignal,
    requestedModelId?: AiAsrModelId,
    requestedBenchmark?: VoiceMemoryBenchmarkRunMetadata,
    onStage?: (stage: VoiceMemoryProcessingStage) => void,
  ): Promise<VoiceMemoryRecord> {
    onStage?.("preprocess");
    const {
      taskId,
      legacyTaskId,
      legacyCheckpoint,
      checkpoint,
      runnable,
      asrModelId,
      asrStatus,
      transcriptionModel,
      audio,
    } = await prepareTranscriptionInput(
      this.models,
      this.runtime,
      record,
      manual,
      signal,
      requestedModelId,
    );
    record = await this.updateDiagnostic(
      record,
      { recordingId: record.recordingId, filePath: record.filePath },
      record.taskId ?? createTaskId(record.recordingId),
      "preprocess",
      "processing",
      {
        inputFormat: audio.inputFormat,
        asrInputFormat: asrStatus.asrInputFormat,
        modelName: asrStatus.modelName,
        modelVersion: asrStatus.modelVersion,
        modelPath: asrStatus.modelPath,
        runtimeMessage: asrStatus.message,
      },
    );
    const activeBenchmark = requestedBenchmark ? record.transcriptionBenchmark : undefined;
    const existingBenchmarkClip = activeBenchmark?.clips?.[0];
    const {
      sourceStartMs,
      sourceEndMs,
      clipDurationMs: totalDuration,
    } = resolveTranscriptionRunRange(audio.durationMs, activeBenchmark);
    if (activeBenchmark) {
      record = {
        ...record,
        transcriptionBenchmark: {
          ...activeBenchmark,
          clips: [
            {
              ...(existingBenchmarkClip ?? {}),
              startMs: 0,
              endMs: totalDuration,
              sourceStartMs,
              sourceEndMs,
              clipLocalStartMs: 0,
              clipLocalEndMs: totalDuration,
            },
          ],
        },
      };
    }
    if (!manual && !canAutomaticallyTranscribeDuration(totalDuration)) {
      throw new Error("automatic_long_recording_requires_manual");
    }
    const { knownSpeakerSegments, resumeParticipantSources, speechSources } =
      await prepareKnownSpeakerSources(
        record,
        asrModelId,
        checkpoint,
        sourceStartMs,
        sourceEndMs,
        signal,
      );
    if (knownSpeakerSegments?.length) {
      const totalUnits = knownSpeakerSegments.length;
      const checkpointCompatible =
        checkpoint?.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION &&
        checkpoint.asrModelId === asrModelId &&
        checkpoint.totalUnits === totalUnits;
      const definitions = knownSpeakerSegments.map((segment, index) => ({
        index,
        startMs: segment.startMs,
        endMs: segment.endMs,
        speakerId: segment.speakerId,
      }));
      const durableUnits = record.transcriptionUnits?.filter(
        (unit) =>
          unit.modelId === asrModelId &&
          unit.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION &&
          unit.index >= 0 &&
          unit.index < totalUnits,
      );
      const canResumeDurably = durableUnits?.length === totalUnits;
      if (!checkpointCompatible && !canResumeDurably && record.transcript.length > 0) {
        throw new Error(
          checkpoint ? "transcription_checkpoint_incompatible" : "transcription_checkpoint_missing",
        );
      }
      if (!checkpointCompatible && checkpoint) await this.models.clearTaskCheckpoint(taskId);
      const units = createTranscriptionUnits(
        record.recordingId,
        asrModelId,
        definitions,
        canResumeDurably ? durableUnits : undefined,
        checkpointCompatible ? Math.min(totalUnits, Math.max(0, checkpoint.completedUnits)) : 0,
      );
      let stats = statsFromTranscriptionUnits(
        totalDuration,
        units,
        record.transcript,
        record.transcriptionStats,
      );
      const completedUnits = stats.completedUnits;
      record = await this.save({
        ...record,
        phase: "transcribing",
        progress: Math.round((completedUnits / totalUnits) * 70),
        transcriptionModel,
        transcriptionUnits: units,
        transcriptionStats: stats,
        errorMessage: undefined,
      });
      for (let unit = 0; unit < totalUnits; unit += 1) {
        if (signal.aborted) throw new Error("ai_task_paused");
        const source = knownSpeakerSegments[unit];
        if (!source) continue;
        const durableUnit = units[unit];
        if (!durableUnit || durableUnit.status === "completed") continue;
        const startedAt = new Date().toISOString();
        Object.assign(durableUnit, {
          status: "running" as const,
          stage: "asr" as const,
          attempts: durableUnit.attempts + 1,
          startedAt,
          heartbeatAt: startedAt,
          updatedAt: startedAt,
        });
        onStage?.("convert");
        const asrStartedAt = performance.now();
        const duration = Math.max(1, source.endMs - source.startMs);
        const chunk = await this.transcribeChunkWithRetry(
          () =>
            this.runtime.transcribeChunk({
              modelId: asrModelId,
              recordingId: record.recordingId,
              filePath: source.filePath,
              offsetMs: source.audioOffsetMs,
              durationMs: duration,
              benchmark: Boolean(activeBenchmark),
              signal,
              manual,
              resourceMode: runnable.resourceMode,
              onStage: (stage, context) => {
                onStage?.(stage);
                this.log("info", "AI speaker segment stage", {
                  taskId: record.taskId,
                  recordingId: record.recordingId,
                  speakerId: source.speakerId,
                  stage,
                  ...context,
                });
              },
            }),
          signal,
          {
            recordingId: record.recordingId,
            taskId: record.taskId,
            unit: unit + 1,
            totalUnits,
            benchmark: Boolean(activeBenchmark),
          },
        );
        const recognized = chunk.segments;
        const chunkResult = chunk.result;
        const finishedAt = new Date().toISOString();
        const outputStatus = chunkResult?.outputStatus;
        const trustworthyCoverage =
          !chunk.failed && (outputStatus === "normal" || outputStatus === "vad_silence");
        Object.assign(durableUnit, {
          status: chunk.failed ? ("failed" as const) : ("completed" as const),
          processedAudioMs: chunk.failed ? 0 : duration,
          coveredAudioMs: trustworthyCoverage ? duration : 0,
          segmentCount: recognized.length,
          commonVad: chunkResult?.commonVad,
          outputStatus,
          anomalyTypes: chunkResult?.anomalyTypes,
          timing: chunkResult?.timing ?? {
            totalTimeMs: chunk.attemptHistory.reduce(
              (sum, attempt) => sum + (attempt.elapsedMs ?? 0),
              0,
            ),
          },
          resourceUsage: chunkResult?.resourceUsage,
          rawRuntimeOutput: JSON.stringify({
            segments: recognized,
            rawText: chunkResult?.rawText,
            rawOutput: chunkResult?.rawOutput,
            commonVad: chunkResult?.commonVad,
            outputStatus,
            anomalyTypes: chunkResult?.anomalyTypes,
            anomalyReasons: chunkResult?.anomalyReasons,
            rawAnomalyAttempts: chunkResult?.rawAnomalyAttempts,
          }),
          normalizedSegmentIds: recognized.map((segment) => segment.id),
          retryCount: chunk.retries,
          attemptHistory: [...(durableUnit.attemptHistory ?? []), ...chunk.attemptHistory],
          attempts: durableUnit.attempts + chunk.retries,
          errorCode: chunk.errorCode,
          errorMessage: chunk.errorMessage,
          completedAt: finishedAt,
          heartbeatAt: finishedAt,
          updatedAt: finishedAt,
        });
        if (typeof this.store.appendTranscriptionUnit === "function") {
          this.writeOwnership.assertCurrent(
            record.recordingId,
            this.requestVersions.get(record.recordingId),
          );
          await this.store.appendTranscriptionUnit(record.recordingId, durableUnit);
        }
        stats = statsFromTranscriptionUnits(totalDuration, units, record.transcript, stats);
        if (chunk.fatal) {
          record = await this.save({
            ...record,
            transcriptionUnits: units,
            transcriptionStats: stats,
            errorMessage: chunk.errorMessage,
          });
          throw new Error(chunk.errorMessage ?? "asr_runtime_fatal");
        }
        const unitSaveStartedAt = performance.now();
        const transcriptionElapsedMs =
          (record.transcriptionElapsedMs ?? 0) +
          Math.max(0, Math.round(performance.now() - asrStartedAt));
        const speakerTranscript = bindTranscriptToKnownSpeaker(
          record.recordingId,
          unit,
          source,
          recognized,
        );
        this.log("info", "Speaker segment transcribed", {
          recordingId: record.recordingId,
          speakerId: source.speakerId,
          displayNameSnapshot: source.displayNameSnapshot,
          startMs: source.startMs,
          endMs: source.endMs,
          asrModelId,
          transcriptCount: speakerTranscript.length,
        });
        const retained = record.transcript.filter(
          (segment) => !segment.id.startsWith(`${record.recordingId}-speaker-${unit}-`),
        );
        const transcript = mergeSpeakerTranscript(retained, speakerTranscript);
        const sourceBySpeaker = new Map(
          knownSpeakerSegments.map((segment) => [segment.speakerId, segment]),
        );
        record = await this.save({
          ...record,
          processingStage: "storage",
          transcriptionElapsedMs,
          transcript,
          speakers: Array.from(new Set(transcript.map((segment) => segment.speakerId))).map(
            (speakerId) => {
              const identity = sourceBySpeaker.get(speakerId);
              return {
                speakerId,
                memberId: speakerId,
                nickname: identity?.displayNameSnapshot,
                displayNameSnapshot: identity?.displayNameSnapshot,
                confidence: "high" as const,
              };
            },
          ),
          progress: Math.round(((unit + 1) / totalUnits) * 70),
          transcriptionStats: {
            ...stats,
            segmentCount: transcript.length,
            speakerCount: new Set(transcript.map((segment) => segment.speakerId)).size,
          },
          transcriptionUnits: units,
        });
        durableUnit.timing = {
          ...(durableUnit.timing ?? {}),
          saveTimeMs: Math.max(0, Math.round(performance.now() - unitSaveStartedAt)),
        };
        stats = record.transcriptionStats ?? stats;
        this.writeOwnership.assertCurrent(
          record.recordingId,
          this.requestVersions.get(record.recordingId),
        );
        await this.models.saveTaskCheckpoint({
          taskId,
          recordingId: record.recordingId,
          kind: "transcription",
          completedUnits: units.filter((candidate) => candidate.status === "completed").length,
          totalUnits,
          unitDurationMs: TRANSCRIPTION_CHUNK_MS,
          pipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
          asrModelId,
          updatedAt: new Date().toISOString(),
        });
      }
      this.log("info", "Speaker-aware transcription completed", {
        recordingId: record.recordingId,
        identitySource: resumeParticipantSources
          ? "participant_tracks_resume"
          : speechSources.length
            ? "speech_segments"
            : "participant_tracks",
        segmentCount: totalUnits,
        speakerCount: record.speakers.length,
        overlappingSegmentsSupported: true,
        speechSegmentsRetainedForComparison: speechSources.length > 0,
      });
      const releaseMetrics = activeBenchmark
        ? await this.runtime.releaseAsrMeasured(
            "model_comparison_model_complete",
            stats.resourceUsage?.gpuMemoryBeforeLoadMb,
          )
        : undefined;
      const terminalStats = statsFromTranscriptionUnits(
        totalDuration,
        units,
        record.transcript,
        stats,
      );
      return this.save({
        ...record,
        transcript: mergeTranscriptIntoSentences(record.transcript),
        transcriptionUnits: units,
        transcriptionStats: {
          ...terminalStats,
          finalResultSaved: true,
          segmentCount: record.transcript.length,
          speakerCount: record.speakers.length,
          lastHeartbeatAt: new Date().toISOString(),
          releaseElapsedMs: releaseMetrics?.releaseTimeMs,
          totalElapsedMs:
            (terminalStats.totalElapsedMs ?? 0) + (releaseMetrics?.releaseTimeMs ?? 0),
          resourceUsage: {
            ...(terminalStats.resourceUsage ?? {}),
            ...releaseMetrics,
            gpuMemoryAfterReleaseMb: releaseMetrics?.gpuMemoryAfterReleaseMb,
            resourceReleaseSucceeded: releaseMetrics?.resourceReleaseSucceeded,
            possibleResourceLeak: releaseMetrics?.possibleResourceLeak,
          },
        },
      });
    }
    const transcriptionChunkMs = transcriptionChunkMsForModel(
      asrModelId,
      TRANSCRIPTION_PIPELINE_VERSION,
      checkpoint,
      record.transcriptionUnits,
    );
    const totalUnits = Math.max(1, Math.ceil(totalDuration / transcriptionChunkMs));
    const checkpointCompatible =
      checkpoint?.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION &&
      checkpoint.asrModelId === asrModelId &&
      checkpoint.totalUnits === totalUnits;
    const definitions = Array.from({ length: totalUnits }, (_, index) => ({
      index,
      startMs: sourceStartMs + index * transcriptionChunkMs,
      endMs: Math.min(sourceEndMs, sourceStartMs + (index + 1) * transcriptionChunkMs),
    }));
    const durableUnits = record.transcriptionUnits?.filter(
      (unit) =>
        unit.modelId === asrModelId &&
        unit.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION &&
        unit.index >= 0 &&
        unit.index < totalUnits,
    );
    const canResumeDurably =
      durableUnits?.length === totalUnits &&
      durableUnits.every(
        (unit, index) =>
          unit.startMs === definitions[index]?.startMs && unit.endMs === definitions[index]?.endMs,
      );
    if (!checkpointCompatible && !canResumeDurably && record.transcript.length > 0) {
      // A non-restart request must never silently destroy a saved partial transcript. Explicit
      // "重新转录" clears both the checkpoint and transcript before entering this method.
      throw new Error(
        checkpoint ? "transcription_checkpoint_incompatible" : "transcription_checkpoint_missing",
      );
    }
    if (!checkpointCompatible && checkpoint) {
      await this.models.clearTaskCheckpoint(taskId);
    }
    const units = createTranscriptionUnits(
      record.recordingId,
      asrModelId,
      definitions,
      canResumeDurably ? durableUnits : undefined,
      checkpointCompatible
        ? completedTranscriptionUnits(checkpoint, totalUnits, transcriptionChunkMs)
        : 0,
    );
    let stats = statsFromTranscriptionUnits(
      totalDuration,
      units,
      record.transcript,
      record.transcriptionStats,
    );
    const completedUnits = stats.completedUnits;
    record = await this.save({
      ...record,
      phase: "transcribing",
      progress: Math.round((completedUnits / totalUnits) * 70),
      transcriptionModel,
      transcriptionUnits: units,
      transcriptionStats: stats,
      errorMessage: undefined,
    });
    for (let unit = 0; unit < totalUnits; unit += 1) {
      if (signal.aborted) throw new Error("ai_task_paused");
      const offsetMs = sourceStartMs + unit * transcriptionChunkMs;
      const durableUnit = units[unit];
      if (!durableUnit || durableUnit.status === "completed") continue;
      const startedAt = new Date().toISOString();
      Object.assign(durableUnit, {
        status: "running" as const,
        stage: "asr" as const,
        attempts: durableUnit.attempts + 1,
        startedAt,
        heartbeatAt: startedAt,
        updatedAt: startedAt,
      });
      onStage?.("convert");
      record = await this.updateDiagnostic(
        record,
        { recordingId: record.recordingId, filePath: record.filePath },
        record.taskId ?? createTaskId(record.recordingId),
        "convert",
        "processing",
        {
          inputFormat: audio.inputFormat,
          asrInputFormat: asrStatus.asrInputFormat,
          modelName: asrStatus.modelName,
          modelVersion: asrStatus.modelVersion,
          modelPath: asrStatus.modelPath,
        },
      );
      const duration = Math.min(transcriptionChunkMs, sourceEndMs - offsetMs);
      const asrStartedAt = performance.now();
      const chunk = await this.transcribeChunkWithRetry(
        () =>
          this.runtime.transcribeChunk({
            modelId: asrModelId,
            recordingId: record.recordingId,
            filePath: record.filePath,
            offsetMs,
            durationMs: duration,
            benchmark: Boolean(activeBenchmark),
            signal,
            manual,
            resourceMode: runnable.resourceMode,
            onStage: (stage, context) => {
              onStage?.(stage);
              this.log("info", "AI pipeline stage", {
                taskId: record.taskId,
                recordingId: record.recordingId,
                stage,
                ...context,
              });
            },
          }),
        signal,
        {
          recordingId: record.recordingId,
          taskId: record.taskId,
          unit: unit + 1,
          totalUnits,
          benchmark: Boolean(activeBenchmark),
        },
      );
      const segments = chunk.segments;
      const chunkResult = chunk.result;
      const finishedAt = new Date().toISOString();
      const outputStatus = chunkResult?.outputStatus;
      const trustworthyCoverage =
        !chunk.failed && (outputStatus === "normal" || outputStatus === "vad_silence");
      Object.assign(durableUnit, {
        status: chunk.failed ? ("failed" as const) : ("completed" as const),
        processedAudioMs: chunk.failed ? 0 : duration,
        coveredAudioMs: trustworthyCoverage ? duration : 0,
        segmentCount: segments.length,
        commonVad: chunkResult?.commonVad,
        outputStatus,
        anomalyTypes: chunkResult?.anomalyTypes,
        timing: chunkResult?.timing ?? {
          totalTimeMs: chunk.attemptHistory.reduce(
            (sum, attempt) => sum + (attempt.elapsedMs ?? 0),
            0,
          ),
        },
        resourceUsage: chunkResult?.resourceUsage,
        rawRuntimeOutput: JSON.stringify({
          segments,
          rawText: chunkResult?.rawText,
          rawOutput: chunkResult?.rawOutput,
          commonVad: chunkResult?.commonVad,
          outputStatus,
          anomalyTypes: chunkResult?.anomalyTypes,
          anomalyReasons: chunkResult?.anomalyReasons,
          rawAnomalyAttempts: chunkResult?.rawAnomalyAttempts,
        }),
        normalizedSegmentIds: segments.map((segment) => segment.id),
        retryCount: chunk.retries,
        attemptHistory: [...(durableUnit.attemptHistory ?? []), ...chunk.attemptHistory],
        attempts: durableUnit.attempts + chunk.retries,
        errorCode: chunk.errorCode,
        errorMessage: chunk.errorMessage,
        completedAt: finishedAt,
        heartbeatAt: finishedAt,
        updatedAt: finishedAt,
      });
      stats = statsFromTranscriptionUnits(totalDuration, units, record.transcript, stats);
      if (chunk.fatal) {
        record = await this.save({
          ...record,
          transcriptionUnits: units,
          transcriptionStats: stats,
          errorMessage: chunk.errorMessage,
        });
        throw new Error(chunk.errorMessage ?? "asr_runtime_fatal");
      }
      const unitSaveStartedAt = performance.now();
      const transcriptionElapsedMs =
        (record.transcriptionElapsedMs ?? 0) +
        Math.max(0, Math.round(performance.now() - asrStartedAt));
      onStage?.("storage");
      this.log("info", "Voice memory chunk transcribed", {
        recordingId: record.recordingId,
        unit: unit + 1,
        totalUnits,
        segmentCount: segments.length,
      });
      const retained = record.transcript.filter(
        (segment) =>
          segment.startMs < offsetMs || segment.startMs >= offsetMs + transcriptionChunkMs,
      );
      const transcript = [...retained, ...segments].sort(
        (left, right) => left.startMs - right.startMs,
      );
      record = await this.save({
        ...record,
        processingStage: "storage",
        transcriptionElapsedMs,
        transcript,
        speakers: Array.from(new Set(transcript.map((segment) => segment.speakerId))).map(
          (speakerId) =>
            record.speakers.find((speaker) => speaker.speakerId === speakerId) ?? {
              speakerId,
              confidence: "pending" as const,
            },
        ),
        progress: Math.round(((unit + 1) / totalUnits) * 70),
        transcriptionStats: {
          ...stats,
          segmentCount: transcript.length,
          speakerCount: new Set(transcript.map((segment) => segment.speakerId)).size,
        },
        transcriptionUnits: units,
      });
      durableUnit.timing = {
        ...(durableUnit.timing ?? {}),
        saveTimeMs: Math.max(0, Math.round(performance.now() - unitSaveStartedAt)),
      };
      stats = record.transcriptionStats ?? stats;
      this.writeOwnership.assertCurrent(
        record.recordingId,
        this.requestVersions.get(record.recordingId),
      );
      await this.models.saveTaskCheckpoint({
        taskId,
        recordingId: record.recordingId,
        kind: "transcription",
        completedUnits: units.filter((candidate) => candidate.status === "completed").length,
        totalUnits,
        unitDurationMs: transcriptionChunkMs,
        pipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
        asrModelId,
        updatedAt: new Date().toISOString(),
      });
      if (legacyCheckpoint?.asrModelId === asrModelId) {
        await this.models.clearTaskCheckpoint(legacyTaskId);
      }
    }
    const releaseMetrics = activeBenchmark
      ? await this.runtime.releaseAsrMeasured(
          "model_comparison_model_complete",
          stats.resourceUsage?.gpuMemoryBeforeLoadMb,
        )
      : undefined;
    const terminalStats = statsFromTranscriptionUnits(
      totalDuration,
      units,
      record.transcript,
      stats,
    );
    return this.save({
      ...record,
      transcript: mergeTranscriptIntoSentences(record.transcript),
      transcriptionUnits: units,
      transcriptionStats: {
        ...terminalStats,
        finalResultSaved: true,
        segmentCount: record.transcript.length,
        speakerCount: record.speakers.length,
        lastHeartbeatAt: new Date().toISOString(),
        releaseElapsedMs: releaseMetrics?.releaseTimeMs,
        totalElapsedMs: (terminalStats.totalElapsedMs ?? 0) + (releaseMetrics?.releaseTimeMs ?? 0),
        resourceUsage: {
          ...(terminalStats.resourceUsage ?? {}),
          ...releaseMetrics,
          gpuMemoryAfterReleaseMb: releaseMetrics?.gpuMemoryAfterReleaseMb,
          resourceReleaseSucceeded: releaseMetrics?.resourceReleaseSucceeded,
          possibleResourceLeak: releaseMetrics?.possibleResourceLeak,
        },
      },
    });
  }

  private transcribeChunkWithRetry(
    operation: Parameters<typeof transcribeChunkWithRetry>[0],
    signal: AbortSignal,
    context: Parameters<typeof transcribeChunkWithRetry>[2],
  ) {
    return transcribeChunkWithRetry(operation, signal, context, this.log.bind(this));
  }

  private organize(
    record: VoiceMemoryRecord,
    manual: boolean,
    signal: AbortSignal,
  ): Promise<VoiceMemoryRecord> {
    return new VoiceMemoryOrganizer(this.textGateway, (next) => this.save(next)).organize(
      record,
      manual,
      signal,
    );
  }

  private async refreshRuntimeStatus(): Promise<void> {
    const statuses = await this.runtime.modelRuntimeStatuses();
    // One runtime scan used to emit one full renderer snapshot per model. Batch the result so
    // opening AI settings produces a single state update instead of a burst of 10+ renders.
    const batchRuntimeStatuses = this.models.setRuntimeStatuses?.bind(this.models);
    if (batchRuntimeStatuses) {
      batchRuntimeStatuses(statuses);
      return;
    }

    // Compatibility for older embedders and narrow test doubles. The shipped manager always
    // provides the batched method above.
    for (const [modelId, status] of Object.entries(statuses)) {
      this.models.setRuntimeStatus(modelId as AiModelId, status.ready, status.message);
    }
  }

  private scheduleDeferredRetry(): void {
    if (this.stopped) return;
    if (this.deferredRetryTimer) clearTimeout(this.deferredRetryTimer);
    if (!this.isAutomaticTranscriptionEnabled()) {
      this.deferredRetryTimer = undefined;
      return;
    }
    this.deferredRetryTimer = setTimeout(() => {
      this.deferredRetryTimer = undefined;
      void this.retryDeferredRecords().catch((error) => {
        this.log("warn", "Deferred transcription retry failed", { reason: this.errorCode(error) });
      });
    }, 9_000);
  }

  private async retryDeferredRecords(): Promise<void> {
    if (this.stopped) return;
    if (!this.isAutomaticTranscriptionEnabled()) return;
    if (this.controllers.size > 0) return this.scheduleDeferredRetry();
    const runnable = this.models.canRunTask("transcription", false);
    if (!runnable.runnable) return;
    const records = await this.store.list();
    for (const record of records.filter((item) => item.errorMessage?.startsWith("deferred:"))) {
      await this.process({
        recordingId: record.recordingId,
        filePath: record.filePath,
        roomId: record.roomId,
        roomName: record.roomName,
        organize: true,
      }).catch(() => undefined);
    }
  }

  private async requireRecord(recordingId: string): Promise<VoiceMemoryRecord> {
    const record = await this.store.get(recordingId);
    if (!record) throw new Error("voice_memory_not_found");
    return this.withTranscriptionModel(record);
  }

  private async runQuestion<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.stopped) throw new Error("ai_task_paused");
    if (this.activeQuestionController) throw new Error("ai_question_in_progress");
    const controller = new AbortController();
    this.activeQuestionController = controller;
    try {
      return await operation(controller.signal);
    } finally {
      if (this.activeQuestionController === controller) this.activeQuestionController = undefined;
    }
  }

  private withTranscriptionModel(record: VoiceMemoryRecord): VoiceMemoryRecord {
    if (record.transcriptionModel || record.transcript.length === 0) return record;
    const modelId =
      Object.values(record.transcriptionVariants ?? {})[0]?.model.id ??
      this.models.getTaskCheckpoint(`transcription:${record.recordingId}`)?.asrModelId;
    return modelId
      ? {
          ...record,
          transcriptionModel: {
            id: modelId,
            name: AI_ASR_MODEL_NAMES[modelId],
          },
        }
      : record;
  }

  private createDiagnostic(
    request: Pick<VoiceMemoryProcessRequest, "recordingId" | "filePath" | "taskId">,
    status: VoiceMemoryTaskStatus,
    stage: VoiceMemoryProcessingStage,
    patch?: Partial<VoiceMemoryTaskDiagnostic>,
  ): VoiceMemoryTaskDiagnostic {
    return {
      taskId: request.taskId ?? createTaskId(request.recordingId),
      status,
      stage,
      fileName: path.basename(request.filePath),
      updatedAt: new Date().toISOString(),
      ...patch,
    };
  }

  private async updateDiagnostic(
    record: VoiceMemoryRecord,
    request: Pick<VoiceMemoryProcessRequest, "recordingId" | "filePath" | "taskId">,
    taskId: string,
    stage: VoiceMemoryProcessingStage,
    status: VoiceMemoryTaskStatus,
    patch?: Partial<VoiceMemoryTaskDiagnostic>,
  ): Promise<VoiceMemoryRecord> {
    const diagnostic = this.createDiagnostic({ ...request, taskId }, status, stage, patch);
    this.lastTask = diagnostic;
    this.log("info", "AI pipeline stage", {
      taskId,
      recordingId: request.recordingId,
      stage,
      status,
      fileName: diagnostic.fileName,
      inputFormat: diagnostic.inputFormat,
      asrInputFormat: diagnostic.asrInputFormat,
    });
    return this.save({
      ...record,
      taskId,
      taskStatus: status,
      processingStage: stage,
      diagnostic,
    });
  }

  private errorCode(error: unknown): string {
    return classifyLocalModelRuntimeError(error);
  }

  private async save(
    record: VoiceMemoryRecord,
    options: VoiceMemorySaveOptions = {},
  ): Promise<VoiceMemoryRecord> {
    this.writeOwnership.assertCurrent(
      record.recordingId,
      this.requestVersions.get(record.recordingId),
    );
    if (this.deletedRecordings.has(record.recordingId)) throw new Error("voice_memory_deleted");
    const persisted = record.transcriptionModel
      ? {
          ...record,
          transcriptionVariants: {
            ...record.transcriptionVariants,
            [record.transcriptionModel.id]: {
              model: record.transcriptionModel,
              transcript: record.transcript,
              speakers: record.speakers,
              pipelineVersion:
                record.transcriptionPipelineVersion ?? TRANSCRIPTION_PIPELINE_VERSION,
              transcriptionElapsedMs: record.transcriptionElapsedMs,
              transcriptionStats: record.transcriptionStats,
              transcriptionUnits: record.transcriptionUnits,
              benchmark: record.transcriptionBenchmark,
              updatedAt: new Date().toISOString(),
            },
          },
        }
      : record;
    const saved = await this.store.save(persisted, options);
    if (saved.diagnostic) this.lastTask = saved.diagnostic;
    this.log("info", "AI pipeline stage", {
      taskId: saved.taskId,
      recordingId: saved.recordingId,
      stage: saved.processingStage ?? "storage",
      status: saved.taskStatus,
      storage: "success",
    });
    for (const listener of this.listeners) listener(saved);
    return saved;
  }

  private log(
    level: RendererLogPayload["level"],
    message: string,
    context: Record<string, unknown>,
  ): void {
    void this.writeLog?.({ category: "app", level, message, context }).catch(() => undefined);
  }
}
