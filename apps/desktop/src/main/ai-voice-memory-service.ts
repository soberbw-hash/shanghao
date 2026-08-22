import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

import {
  AI_ASR_MODEL_NAMES,
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  hasInvalidVoiceMemoryResult,
  isReliableTranscriptText,
  type AiAsrModelId,
  type AiModelId,
  type AiAsrRuntimeStatus,
  type AiRuntimeStatus,
  type RendererLogPayload,
  type VoiceMemoryAnswer,
  type VoiceMemoryGlobalQuestionRequest,
  type VoiceMemoryChapter,
  type VoiceMemoryHighlight,
  type VoiceMemoryMarkerTitle,
  type VoiceMemoryProcessRequest,
  type VoiceMemoryQuestionRequest,
  type VoiceMemoryRecord,
  type VoiceMemorySearchRequest,
  type VoiceMemorySearchResult,
  type VoiceMemorySpeakingObservation,
  type VoiceMemorySummaryPoint,
  type VoiceMemoryProcessingStage,
  type VoiceMemoryTaskDiagnostic,
  type VoiceMemoryTaskStatus,
  type VoiceMemoryTranscriptionModel,
} from "@private-voice/shared";

import { AiModelManager } from "./ai-model-manager";
import { AiRuntimeManager } from "./ai-runtime-manager";
import { classifyLocalModelRuntimeError } from "./local-model-runtime";
import { VoiceMemoryStore } from "./voice-memory-store";
import { resolveFfmpegExecutable } from "./media-runtime";
import { AiTextGateway } from "./ai-text-gateway";

// Short units bound local inference memory and preserve useful seek points for models without
// word-level timestamps.
export const TRANSCRIPTION_CHUNK_MS = 30_000;
export const AUTOMATIC_TRANSCRIPTION_MAX_DURATION_MS = 30 * 60_000;
const LEGACY_TRANSCRIPTION_CHUNK_MS = 10 * 60_000;
// Version 7 adds the Mandarin-only transcript guard and invalidates older multilingual results.
// Partial results from older recognition runs must not be mixed into the guarded transcript.
const TRANSCRIPTION_PIPELINE_VERSION = CURRENT_TRANSCRIPTION_PIPELINE_VERSION;

export const canAutomaticallyTranscribeDuration = (durationMs: number): boolean =>
  durationMs <= AUTOMATIC_TRANSCRIPTION_MAX_DURATION_MS;

export const transcriptionModelMetadata = (
  modelId: AiAsrModelId,
  status: AiAsrRuntimeStatus,
): VoiceMemoryTranscriptionModel => ({
  id: modelId,
  name: status.modelName?.trim() || AI_ASR_MODEL_NAMES[modelId],
  ...(status.modelVersion?.trim() ? { version: status.modelVersion.trim() } : {}),
});

export const completedTranscriptionUnits = (
  checkpoint: { completedUnits: number; unitDurationMs?: number } | undefined,
  totalUnits: number,
): number =>
  Math.min(
    totalUnits,
    Math.floor(
      ((checkpoint?.completedUnits ?? 0) *
        (checkpoint?.unitDurationMs ?? LEGACY_TRANSCRIPTION_CHUNK_MS)) /
        TRANSCRIPTION_CHUNK_MS,
    ),
  );

interface OrganizedResult {
  summary: VoiceMemorySummaryPoint[];
  chapters: VoiceMemoryChapter[];
  highlights: VoiceMemoryHighlight[];
  markerTitles: VoiceMemoryMarkerTitle[];
}

const durationMs = async (
  filePath: string,
): Promise<{ durationMs: number; inputFormat?: string }> =>
  new Promise((resolve, reject) => {
    const executable = resolveFfmpegExecutable();
    if (!executable) return reject(new Error("ffmpeg_missing"));
    const child: ChildProcessWithoutNullStreams = spawn(
      executable,
      ["-nostdin", "-hide_banner", "-i", filePath],
      { windowsHide: true },
    );
    let output = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (value: string) => (output += value));
    child.on("error", (error) =>
      reject(new Error("ffmpeg_probe_failed: " + (error instanceof Error ? error.message : error))),
    );
    child.stdin.end();
    child.on("close", () => {
      // FFmpeg emits this fixed header in bounded local diagnostic output.
      // eslint-disable-next-line security/detect-unsafe-regex
      const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
      const seconds = match
        ? Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])
        : Number.NaN;
      if (!Number.isFinite(seconds) || seconds <= 0) {
        const detail = output.trim().slice(-500);
        return reject(new Error(detail || "recording_duration_unavailable"));
      }
      const audioLine = output.match(/Audio:\s*([^\r\n]+)/i)?.[1]?.trim();
      resolve({ durationMs: Math.round(seconds * 1_000), inputFormat: audioLine });
    });
  });

const createTaskId = (recordingId: string): string =>
  `voice-memory:${recordingId}:${Date.now()}-${randomUUID().slice(0, 8)}`;

const emptyRecord = (request: VoiceMemoryProcessRequest): VoiceMemoryRecord => ({
  schemaVersion: 1,
  recordingId: request.recordingId,
  filePath: request.filePath,
  roomId: request.roomId,
  roomName: request.roomName,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  phase: "idle",
  progress: 0,
  speakers: [],
  transcript: [],
  summary: [],
  chapters: [],
  highlights: [],
  markerTitles: (request.markers ?? []).map((marker) => ({
    markerId: marker.id,
    offsetMs: marker.offsetMs,
    title: `标记 ${Math.round(marker.offsetMs / 1_000)} 秒`,
  })),
  timeline: (request.markers ?? []).map((marker) => ({
    id: marker.id,
    kind: "marker" as const,
    offsetMs: marker.offsetMs,
    title: `标记 ${Math.round(marker.offsetMs / 1_000)} 秒`,
  })),
});

export const applySpeakingTimeline = (
  record: VoiceMemoryRecord,
  observations: VoiceMemorySpeakingObservation[],
): VoiceMemoryRecord => {
  if (!observations.length) return record;
  const updates = new Map<
    string,
    { memberId: string; nickname: string; confidence: "high" | "medium" }
  >();
  for (const speakerId of new Set(record.transcript.map((segment) => segment.speakerId))) {
    const scores = new Map<string, { memberId: string; nickname: string; count: number }>();
    for (const segment of record.transcript.filter((item) => item.speakerId === speakerId)) {
      for (const observation of observations) {
        if (
          observation.offsetMs < segment.startMs - 350 ||
          observation.offsetMs > segment.endMs + 350
        )
          continue;
        const current = scores.get(observation.memberId);
        scores.set(observation.memberId, {
          memberId: observation.memberId,
          nickname: observation.nickname,
          count: (current?.count ?? 0) + 1,
        });
      }
    }
    const ranked = [...scores.values()].sort((left, right) => right.count - left.count);
    const total = ranked.reduce((sum, item) => sum + item.count, 0);
    const best = ranked[0];
    const second = ranked[1];
    if (!best || total === 0) continue;
    const share = best.count / total;
    if (share < 0.62 || (second && best.count < second.count * 1.45)) continue;
    updates.set(speakerId, {
      memberId: best.memberId,
      nickname: best.nickname,
      confidence: share >= 0.78 ? "high" : "medium",
    });
  }
  return {
    ...record,
    speakers: record.speakers.map((speaker) => ({
      ...speaker,
      ...(updates.get(speaker.speakerId) ?? {}),
    })),
    transcript: record.transcript.map((segment) => ({
      ...segment,
      ...(updates.get(segment.speakerId) ?? {}),
    })),
  };
};

const transcriptForPrompt = (record: VoiceMemoryRecord, maximumCharacters = 36_000): string =>
  record.transcript
    .filter((segment) =>
      isReliableTranscriptText(segment.text, Math.max(100, segment.endMs - segment.startMs)),
    )
    .map(
      (segment) =>
        `[${Math.round(segment.startMs / 1_000)}s] ${segment.nickname ?? segment.speakerId}: ${segment.text}`,
    )
    .join("\n")
    .slice(0, maximumCharacters);

const asArray = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  return value && typeof value === "object" ? [value as T] : [];
};

const normalizeOrganizedResult = (value: unknown, record: VoiceMemoryRecord): OrganizedResult => {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const summary = asArray<Record<string, unknown>>(raw.summary)
    .filter((item) => typeof item.text === "string" && item.text.trim())
    .map((item) => ({
      text: String(item.text).trim(),
      sourceStartMs: typeof item.sourceStartMs === "number" ? item.sourceStartMs : undefined,
      sourceSegmentIds: Array.isArray(item.sourceSegmentIds)
        ? item.sourceSegmentIds.map((id) => {
            if (typeof id === "number") return record.transcript[id]?.id ?? String(id);
            return String(id);
          })
        : undefined,
    }));
  const chapters = asArray<Record<string, unknown>>(raw.chapters)
    .filter((item) => typeof item.title === "string" && Number.isFinite(Number(item.startMs)))
    .map((item, index) => ({
      id: String(item.id ?? `chapter-${index + 1}`),
      startMs: Number(item.startMs),
      title: String(item.title).trim(),
      description: typeof item.description === "string" ? item.description.trim() : undefined,
    }));
  const highlights = asArray<Record<string, unknown>>(raw.highlights)
    .filter(
      (item) =>
        typeof item.title === "string" &&
        Number.isFinite(Number(item.startMs)) &&
        Number.isFinite(Number(item.endMs)),
    )
    .map((item, index) => ({
      id: String(item.id ?? `highlight-${index + 1}`),
      title: String(item.title).trim(),
      startMs: Number(item.startMs),
      endMs: Number(item.endMs),
      description: typeof item.description === "string" ? item.description.trim() : "",
      transcriptSegmentIds: Array.isArray(item.transcriptSegmentIds)
        ? item.transcriptSegmentIds.map((id) => String(id))
        : [],
      exportable: item.exportable !== false,
    }));
  const markerTitles = asArray<Record<string, unknown>>(raw.markerTitles)
    .filter(
      (item) =>
        typeof item.markerId === "string" &&
        typeof item.title === "string" &&
        Number.isFinite(Number(item.offsetMs)),
    )
    .map((item) => ({
      markerId: String(item.markerId),
      offsetMs: Number(item.offsetMs),
      title: String(item.title).trim(),
    }));
  return { summary, chapters, highlights, markerTitles };
};

/** Runs resumable transcription and organization while persisting every completed unit. */
export class AiVoiceMemoryService {
  private readonly listeners = new Set<(record: VoiceMemoryRecord) => void>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly pendingProcesses = new Map<string, Promise<VoiceMemoryRecord>>();
  private readonly requestVersions = new Map<string, number>();
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

  constructor(
    private readonly models: AiModelManager,
    private readonly runtime: AiRuntimeManager,
    private readonly textGateway: AiTextGateway,
    private readonly store: VoiceMemoryStore,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
    const records = await this.store.list();
    this.lastTask = records
      .filter((record) => record.diagnostic)
      .sort((left, right) =>
        (right.diagnostic?.updatedAt ?? "").localeCompare(left.diagnostic?.updatedAt ?? ""),
      )[0]?.diagnostic;
    const interrupted = records.filter(
      (record) => record.phase === "transcribing" || record.phase === "organizing",
    );
    for (const record of interrupted) {
      await this.save({
        ...record,
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
    await this.refreshRuntimeStatus();
    this.models.onStatus(() => this.scheduleDeferredRetry());
    this.scheduleDeferredRetry();
  }

  onStatus(listener: (record: VoiceMemoryRecord) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRuntimeStatus(): Promise<AiRuntimeStatus> {
    return this.runtime.status().then((status) => ({ ...status, lastTask: this.lastTask }));
  }

  async get(recordingId: string): Promise<VoiceMemoryRecord | undefined> {
    const record = await this.store.get(recordingId);
    return record ? this.withTranscriptionModel(record) : undefined;
  }

  async list(): Promise<VoiceMemoryRecord[]> {
    return (await this.store.list()).map((record) => this.withTranscriptionModel(record));
  }

  search(request: VoiceMemorySearchRequest): VoiceMemorySearchResult[] {
    return this.store.search(request);
  }

  pause(recordingId: string): void {
    this.controllers.get(recordingId)?.abort();
  }

  cancelQuestion(): boolean {
    if (!this.activeQuestionController || this.activeQuestionController.signal.aborted)
      return false;
    this.activeQuestionController.abort();
    return true;
  }

  async delete(recordingId: string): Promise<void> {
    this.deletedRecordings.add(recordingId);
    this.requestVersions.set(recordingId, (this.requestVersions.get(recordingId) ?? 0) + 1);
    this.controllers.get(recordingId)?.abort();
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
      phase: "ready",
      progress: 100,
      errorMessage: undefined,
    });
  }

  /** Acknowledges a UI retry immediately while the durable worker continues in the background. */
  async start(request: VoiceMemoryProcessRequest): Promise<VoiceMemoryRecord> {
    // A retry button can be clicked more than once while the request is waiting
    // behind another long recording. Keep the first accepted task instead of
    // replacing it with another task for the same recording.
    if (this.pendingProcesses.has(request.recordingId)) {
      const pendingRecord = await this.store.get(request.recordingId);
      if (pendingRecord) return pendingRecord;
    }
    const previousRecord = await this.store.get(request.recordingId);
    const previous = previousRecord ? this.withTranscriptionModel(previousRecord) : undefined;
    const taskId = request.taskId ?? createTaskId(request.recordingId);
    const queuedRequest = {
      ...request,
      taskId,
      restartTranscription:
        request.transcribe !== false &&
        (request.restartTranscription === true ||
          (request.manual === true && Boolean(previous && hasInvalidVoiceMemoryResult(previous)))),
    };
    const queued = await this.save({
      ...(previous ?? emptyRecord(queuedRequest)),
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
      return this.processNow(request);
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
      markers?: Array<{ id: string; offsetMs: number }>;
    }>,
    organize: boolean,
  ): Promise<void> {
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
        roomName: recording.roomId === "side" ? "二号房" : "一号房",
        organize,
        markers: recording.markers,
        taskId,
      };
      await this.save({
        ...(record ?? emptyRecord(queuedRequest)),
        phase: "idle",
        taskId,
        taskStatus: "pending",
        processingStage: "recording",
        diagnostic: this.createDiagnostic(queuedRequest, "pending", "recording"),
        errorMessage: undefined,
      });
      this.queueAutomaticProcess(queuedRequest);
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
    const taskId = request.taskId ?? createTaskId(request.recordingId);
    this.log("info", "Voice memory processing started", {
      recordingId: request.recordingId,
      taskId,
      manual: request.manual === true,
      restartTranscription: request.restartTranscription === true,
    });
    const previous = await this.store.get(request.recordingId);
    let record = previous ?? emptyRecord(request);
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
            organizedAt: undefined,
            errorMessage: undefined,
          });
        }
        record = await this.transcribe(
          record,
          request.manual === true,
          controller.signal,
          request.asrModelId,
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
        return this.save({
          ...record,
          phase: "ready",
          progress: 100,
          taskId,
          taskStatus: "success",
          processingStage: "transcript",
          diagnostic: this.createDiagnostic(request, "success", "transcript", {
            errorCode: "no_reliable_speech",
            errorMessage: "没有检测到可识别的人声。",
          }),
          transcriptionPipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
          errorMessage: "no_reliable_speech",
        });
      }
      record = await this.save({
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
          this.log("warn", "Voice memory organization failed; transcript retained", {
            recordingId: record.recordingId,
            reason: organizationError,
          });
        }
      }
      record = await this.save({
        ...record,
        phase: "ready",
        progress: 100,
        taskId,
        taskStatus: organizationError ? "failed" : "success",
        processingStage: organizationError ? "organize" : "storage",
        diagnostic: this.createDiagnostic(
          request,
          organizationError ? "failed" : "success",
          organizationError ? "organize" : "storage",
          organizationError ? { errorMessage: `organize_failed:${organizationError}` } : undefined,
        ),
        transcriptionPipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
        errorMessage: organizationError ? `organize_failed:${organizationError}` : undefined,
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
      record = await this.save({
        ...durableRecord,
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
        purpose: "question",
        manual: true,
        maxNewTokens: 700,
        signal,
        prompt: [
          "你是上号的本地语音记忆助手。只根据给出的录音片段回答朋友间的日常问题。",
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
      text: String(answer.text ?? ""),
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
    const candidates = this.store.related(question, 24);
    const answer = await this.runQuestion((signal) =>
      this.textGateway.generateJson<VoiceMemoryAnswer>({
        purpose: "question",
        manual: true,
        maxNewTokens: 700,
        signal,
        prompt: [
          "你是上号房间里的中文助手。用户可能在查找朋友语音记忆，也可能在问普通问题。",
          "有相关语音记忆时优先依据它们回答，并给出来源；没有相关记忆时可以正常回答常识问题，但不要编造录音来源。",
          '只返回 JSON：{"text":"回答","sources":[{"segmentId":"memory-1","startMs":数字,"quote":"简短原话"}]}。来源编号必须取自下面的 memory-N；没有录音依据时 sources 返回空数组。',
          `问题：${question}`,
          "可能相关的本地语音记忆：",
          ...(candidates.length
            ? candidates.map(
                (item, index) =>
                  `memory-${index + 1}\t${item.roomName ?? "房间"}\t${item.createdAt}\t${item.startMs}\t${item.kind}\t${item.title}\t${item.excerpt}`,
              )
            : ["没有检索到相关语音记忆。"]),
        ].join("\n"),
      }),
    );
    return {
      text: String(answer.text ?? ""),
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
    onStage?: (stage: VoiceMemoryProcessingStage) => void,
  ): Promise<VoiceMemoryRecord> {
    const selectedModelId =
      requestedModelId ?? record.transcriptionModel?.id ?? this.models.getActiveAsrModel();
    const taskId = `transcription:${record.recordingId}:${selectedModelId}`;
    const legacyTaskId = `transcription:${record.recordingId}`;
    const modelCheckpoint = this.models.getTaskCheckpoint(taskId);
    const legacyCheckpoint = this.models.getTaskCheckpoint(legacyTaskId);
    const checkpoint =
      modelCheckpoint ??
      (legacyCheckpoint?.asrModelId === selectedModelId ? legacyCheckpoint : undefined);
    const checkpointModel =
      checkpoint?.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION
        ? checkpoint.asrModelId
        : undefined;
    // "Continue transcription" belongs to the recording, not to the model currently selected
    // in Settings. Pin a valid checkpoint to its original ASR so changing the default model does
    // not restart the recording or mix two recognizers in one transcript.
    const runnable = this.models.canRunTask(
      "transcription",
      manual,
      checkpointModel ?? selectedModelId,
    );
    if (!runnable.runnable) throw new Error(runnable.reason);
    const asrModelId = runnable.requiredModel as AiAsrModelId;
    const asrStatus = (await this.runtime.status(asrModelId)).asr;
    const transcriptionModel = transcriptionModelMetadata(asrModelId, asrStatus);
    onStage?.("preprocess");
    const audio = await durationMs(record.filePath);
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
    const totalDuration = audio.durationMs;
    if (!manual && !canAutomaticallyTranscribeDuration(totalDuration)) {
      throw new Error("automatic_long_recording_requires_manual");
    }
    const totalUnits = Math.max(1, Math.ceil(totalDuration / TRANSCRIPTION_CHUNK_MS));
    const checkpointCompatible =
      checkpoint?.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION &&
      checkpoint.asrModelId === asrModelId;
    let completedUnits = checkpointCompatible
      ? completedTranscriptionUnits(checkpoint, totalUnits)
      : 0;
    if (!checkpointCompatible && record.transcript.length > 0) {
      // A non-restart request must never silently destroy a saved partial transcript. Explicit
      // "重新转录" clears both the checkpoint and transcript before entering this method.
      throw new Error(
        checkpoint ? "transcription_checkpoint_incompatible" : "transcription_checkpoint_missing",
      );
    }
    if (!checkpointCompatible && checkpoint) {
      await this.models.clearTaskCheckpoint(taskId);
    }
    record = await this.save({
      ...record,
      phase: "transcribing",
      progress: Math.round((completedUnits / totalUnits) * 70),
      transcriptionModel,
      errorMessage: undefined,
    });
    for (let unit = completedUnits; unit < totalUnits; unit += 1) {
      if (signal.aborted) throw new Error("ai_task_paused");
      const offsetMs = unit * TRANSCRIPTION_CHUNK_MS;
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
      const segments = await this.runtime.transcribeChunk({
        modelId: asrModelId,
        recordingId: record.recordingId,
        filePath: record.filePath,
        offsetMs,
        durationMs: Math.min(TRANSCRIPTION_CHUNK_MS, totalDuration - offsetMs),
        signal,
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
      });
      onStage?.("storage");
      this.log("info", "Voice memory chunk transcribed", {
        recordingId: record.recordingId,
        unit: unit + 1,
        totalUnits,
        segmentCount: segments.length,
      });
      const retained = record.transcript.filter(
        (segment) =>
          segment.startMs < offsetMs || segment.startMs >= offsetMs + TRANSCRIPTION_CHUNK_MS,
      );
      record = await this.save({
        ...record,
        processingStage: "storage",
        transcript: [...retained, ...segments].sort((a, b) => a.startMs - b.startMs),
        speakers: Array.from(
          new Set([...retained, ...segments].map((segment) => segment.speakerId)),
        ).map(
          (speakerId) =>
            record.speakers.find((speaker) => speaker.speakerId === speakerId) ?? {
              speakerId,
              confidence: "pending" as const,
            },
        ),
        progress: Math.round(((unit + 1) / totalUnits) * 70),
      });
      completedUnits = unit + 1;
      await this.models.saveTaskCheckpoint({
        taskId,
        recordingId: record.recordingId,
        kind: "transcription",
        completedUnits,
        totalUnits,
        unitDurationMs: TRANSCRIPTION_CHUNK_MS,
        pipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
        asrModelId,
        updatedAt: new Date().toISOString(),
      });
      if (legacyCheckpoint?.asrModelId === asrModelId) {
        await this.models.clearTaskCheckpoint(legacyTaskId);
      }
    }
    return record;
  }

  private async organize(
    record: VoiceMemoryRecord,
    manual: boolean,
    signal: AbortSignal,
  ): Promise<VoiceMemoryRecord> {
    if (record.transcript.length === 0) return record;
    record = await this.save({
      ...record,
      phase: "organizing",
      progress: 75,
      errorMessage: undefined,
    });
    const result = await this.textGateway.generateJson<OrganizedResult>({
      purpose: "organize",
      manual,
      maxNewTokens: 384,
      timeoutMs: 4 * 60_000,
      signal,
      prompt: [
        "你是上号语音软件的本地整理助手。这里是固定好友的日常聊天，不是会议。",
        "请生成自然、有趣、能回到原录音的结构化结果。不要写会议背景、议程、待办或企业话术。",
        '只返回 JSON 对象，第一字符必须是 {，最后一个字符必须是 }，禁止 ```、Markdown 和任何解释。模板：{"summary":[{"text":"总结","sourceStartMs":0,"sourceSegmentIds":[]}],"chapters":[],"highlights":[],"markerTitles":[]}。四个字段必须始终是数组；所有 id 必须是字符串；没有内容就返回空数组。',
        "章节数量随内容和时长决定；精彩片段只选择真正值得回看的内容；不要编造原文没有的信息。",
        `已有标记：${record.markerTitles.map((marker) => `${marker.markerId}@${marker.offsetMs}ms`).join(", ") || "无"}`,
        `录音：${path.basename(record.filePath)}`,
        transcriptForPrompt(record, 6_000),
      ].join("\n"),
    });
    const normalized = normalizeOrganizedResult(result, record);
    return this.save({
      ...record,
      summary: normalized.summary,
      chapters: normalized.chapters,
      highlights: normalized.highlights,
      markerTitles:
        normalized.markerTitles.length > 0 ? normalized.markerTitles : record.markerTitles,
      organizedAt: new Date().toISOString(),
      timeline: [
        ...record.timeline
          .filter((entry) => entry.kind === "marker")
          .map((entry) => ({
            ...entry,
            title:
              normalized.markerTitles.find((marker) => marker.markerId === entry.id)?.title ??
              entry.title,
          })),
        ...normalized.chapters.map((chapter) => ({
          id: chapter.id || randomUUID(),
          kind: "chapter" as const,
          offsetMs: chapter.startMs,
          title: chapter.title,
          detail: chapter.description,
        })),
        ...normalized.highlights.map((highlight) => ({
          id: highlight.id || randomUUID(),
          kind: "highlight" as const,
          offsetMs: highlight.startMs,
          endMs: highlight.endMs,
          title: highlight.title,
          detail: highlight.description,
        })),
      ].sort((a, b) => a.offsetMs - b.offsetMs),
      progress: 98,
    });
  }

  private async refreshRuntimeStatus(): Promise<void> {
    const statuses = await this.runtime.modelRuntimeStatuses();
    for (const [id, status] of Object.entries(statuses)) {
      this.models.setRuntimeStatus(id as AiModelId, status.ready, status.message);
    }
  }

  private scheduleDeferredRetry(): void {
    if (this.deferredRetryTimer) clearTimeout(this.deferredRetryTimer);
    this.deferredRetryTimer = setTimeout(() => {
      this.deferredRetryTimer = undefined;
      void this.retryDeferredRecords();
    }, 9_000);
  }

  private async retryDeferredRecords(): Promise<void> {
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

  private async save(record: VoiceMemoryRecord): Promise<VoiceMemoryRecord> {
    if (this.deletedRecordings.has(record.recordingId)) throw new Error("voice_memory_deleted");
    const persisted =
      record.transcriptionModel && record.transcript.length > 0
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
                updatedAt: new Date().toISOString(),
              },
            },
          }
        : record;
    const saved = await this.store.save(persisted);
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
