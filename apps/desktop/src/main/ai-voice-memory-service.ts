import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";

import {
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  isReliableTranscriptText,
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
} from "@private-voice/shared";

import { AiModelManager } from "./ai-model-manager";
import { AiRuntimeManager } from "./ai-runtime-manager";
import { VoiceMemoryStore } from "./voice-memory-store";

// The BitNet ASR model returns plain text rather than reliable word timestamps. Short units
// preserve useful seek points and avoid asking one generation to represent several minutes.
export const TRANSCRIPTION_CHUNK_MS = 30_000;
const LEGACY_TRANSCRIPTION_CHUNK_MS = 10 * 60_000;
// Version 6 adds verified UTF-8/native JSON parsing and a pinned local runtime. Partial results
// from older recognition runs must not be mixed into the guarded transcript.
const TRANSCRIPTION_PIPELINE_VERSION = CURRENT_TRANSCRIPTION_PIPELINE_VERSION;

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

const durationMs = async (filePath: string): Promise<number> =>
  new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg_runtime_unavailable"));
    const child: ChildProcessWithoutNullStreams = spawn(
      ffmpegPath,
      ["-hide_banner", "-i", filePath],
      { windowsHide: true },
    );
    let output = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (value: string) => (output += value));
    child.on("error", reject);
    child.on("close", () => {
      // FFmpeg emits this fixed header in bounded local diagnostic output.
      // eslint-disable-next-line security/detect-unsafe-regex
      const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
      const seconds = match
        ? Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])
        : Number.NaN;
      if (!Number.isFinite(seconds) || seconds <= 0)
        return reject(new Error("recording_duration_unavailable"));
      resolve(Math.round(seconds * 1_000));
    });
  });

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
  private deferredRetryTimer?: NodeJS.Timeout;

  constructor(
    private readonly models: AiModelManager,
    private readonly runtime: AiRuntimeManager,
    private readonly store: VoiceMemoryStore,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  async initialize(): Promise<void> {
    await this.store.initialize();
    const interrupted = (await this.store.list()).filter(
      (record) => record.phase === "transcribing" || record.phase === "organizing",
    );
    for (const record of interrupted) {
      await this.save({
        ...record,
        phase: "paused",
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
    return this.runtime.status();
  }

  get(recordingId: string): Promise<VoiceMemoryRecord | undefined> {
    return this.store.get(recordingId);
  }

  list(): Promise<VoiceMemoryRecord[]> {
    return this.store.list();
  }

  search(request: VoiceMemorySearchRequest): VoiceMemorySearchResult[] {
    return this.store.search(request);
  }

  pause(recordingId: string): void {
    this.controllers.get(recordingId)?.abort();
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
    return this.start({
      recordingId,
      filePath: record.filePath,
      roomId: record.roomId,
      roomName: record.roomName,
      manual: true,
      organize: true,
    });
  }

  /** Acknowledges a UI retry immediately while the durable worker continues in the background. */
  async start(request: VoiceMemoryProcessRequest): Promise<VoiceMemoryRecord> {
    const previous = await this.store.get(request.recordingId);
    const queued = await this.save({
      ...(previous ?? emptyRecord(request)),
      phase: "idle",
      errorMessage: undefined,
    });
    if (request.manual) {
      void this.process(request).catch(() => undefined);
    } else {
      this.queueAutomaticProcess(request);
    }
    return queued;
  }

  process(request: VoiceMemoryProcessRequest): Promise<VoiceMemoryRecord> {
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
            return (await this.store.get(request.recordingId)) ?? emptyRecord(request);
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
      await this.save({
        ...(record ??
          emptyRecord({
            recordingId,
            filePath: recording.filePath,
            roomId: recording.roomId,
            roomName: recording.roomId === "side" ? "二号房" : "一号房",
            markers: recording.markers,
          })),
        phase: "idle",
        errorMessage: undefined,
      });
      this.queueAutomaticProcess({
        recordingId,
        filePath: recording.filePath,
        roomId: recording.roomId,
        roomName: recording.roomId === "side" ? "二号房" : "一号房",
        organize,
        markers: recording.markers,
      });
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
          return this.process({ ...request, organize: true });
        })
        .catch(() => undefined);
    } else {
      void transcription.catch(() => undefined);
    }
  }

  private async processNow(request: VoiceMemoryProcessRequest): Promise<VoiceMemoryRecord> {
    this.log("info", "Voice memory processing started", {
      recordingId: request.recordingId,
      manual: request.manual === true,
      restartTranscription: request.restartTranscription === true,
    });
    await this.runtime.validateInputFile(request.filePath);
    const previous = await this.store.get(request.recordingId);
    let record = previous ?? emptyRecord(request);
    if (request.restartTranscription) {
      await this.models.clearTaskCheckpoint(`transcription:${record.recordingId}`);
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
        errorMessage: undefined,
      });
    }
    const controller = new AbortController();
    this.controllers.get(request.recordingId)?.abort();
    this.controllers.set(request.recordingId, controller);
    try {
      record = await this.transcribe(record, request.manual === true, controller.signal);
      record = applySpeakingTimeline(record, request.speakingTimeline ?? []);
      if (record.transcript.length === 0) {
        this.log("info", "Voice memory contained no reliable speech", {
          recordingId: record.recordingId,
        });
        return this.save({
          ...record,
          phase: "ready",
          progress: 100,
          transcriptionPipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
          errorMessage: "no_reliable_speech",
        });
      }
      record = await this.save({
        ...record,
        transcriptionPipelineVersion: TRANSCRIPTION_PIPELINE_VERSION,
      });
      let organizationError: string | undefined;
      if (request.organize !== false) {
        try {
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
      this.log(paused ? "info" : "error", "Voice memory processing stopped", {
        recordingId: record.recordingId,
        reason,
        paused,
      });
      const deferred =
        !request.manual &&
        (reason === "waiting_for_game_to_finish" ||
          reason === "realtime_pressure" ||
          reason.startsWith("voice_") ||
          reason.startsWith("screen_share") ||
          reason.startsWith("peer_recovery") ||
          reason.startsWith("network_quality") ||
          reason.startsWith("renderer_memory"));
      record = await this.save({
        ...record,
        phase: paused || deferred ? "paused" : "error",
        errorMessage: deferred ? `deferred:${reason}` : paused ? undefined : reason,
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
    const runnable = this.models.canRunTask("question", true);
    if (!runnable.runnable) throw new Error(runnable.reason);
    this.models.markQwenTaskStarted(`question:${record.recordingId}`);
    try {
      return await this.runtime.generateJson<VoiceMemoryAnswer>({
        resourceMode: runnable.resourceMode,
        maxNewTokens: 700,
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
      });
    } finally {
      this.models.markAiTaskFinished();
    }
  }

  async askMemory(request: VoiceMemoryGlobalQuestionRequest): Promise<VoiceMemoryAnswer> {
    const question = request.question.trim().slice(0, 500);
    if (!question) throw new Error("memory_question_required");
    const candidates = this.store.related(question, 24);
    const runnable = this.models.canRunTask("question", true);
    if (!runnable.runnable) throw new Error(runnable.reason);
    this.models.markQwenTaskStarted("question:global");
    try {
      return await this.runtime.generateJson<VoiceMemoryAnswer>({
        resourceMode: runnable.resourceMode,
        maxNewTokens: 420,
        prompt: [
          "你是上号里的本地千问助手。用户可能在查找朋友语音记忆，也可能在问普通问题。",
          "有相关语音记忆时优先依据它们回答，并给出来源；没有相关记忆时可以正常回答常识问题，但不要编造录音来源。",
          '只返回 JSON：{"text":"回答","sources":[{"recordingId":"录音ID","filePath":"文件路径","roomName":"房间","createdAt":"时间","startMs":数字,"segmentId":"来源ID","quote":"简短原话"}]}。没有录音依据时 sources 返回空数组。',
          `问题：${question}`,
          "可能相关的本地语音记忆：",
          ...(candidates.length
            ? candidates.map(
                (item, index) =>
                  `${index + 1}\t${item.recordingId}\t${item.filePath}\t${item.roomName ?? "房间"}\t${item.createdAt}\t${item.startMs}\t${item.kind}\t${item.title}\t${item.excerpt}`,
              )
            : ["没有检索到相关语音记忆。"]),
        ].join("\n"),
      });
    } finally {
      this.models.markAiTaskFinished();
    }
  }

  private async transcribe(
    record: VoiceMemoryRecord,
    manual: boolean,
    signal: AbortSignal,
  ): Promise<VoiceMemoryRecord> {
    const runnable = this.models.canRunTask("transcription", manual);
    if (!runnable.runnable) throw new Error(runnable.reason);
    const totalDuration = await durationMs(record.filePath);
    const totalUnits = Math.max(1, Math.ceil(totalDuration / TRANSCRIPTION_CHUNK_MS));
    const taskId = `transcription:${record.recordingId}`;
    const checkpoint = this.models.getTaskCheckpoint(taskId);
    const checkpointCompatible = checkpoint?.pipelineVersion === TRANSCRIPTION_PIPELINE_VERSION;
    let completedUnits = checkpointCompatible
      ? completedTranscriptionUnits(checkpoint, totalUnits)
      : 0;
    if (!checkpointCompatible && (checkpoint || record.transcript.length > 0)) {
      if (checkpoint) await this.models.clearTaskCheckpoint(taskId);
      record = await this.save({
        ...record,
        progress: 0,
        speakers: [],
        transcript: [],
        summary: [],
        chapters: [],
        highlights: [],
        timeline: record.timeline.filter((entry) => entry.kind === "marker"),
      });
    }
    record = await this.save({
      ...record,
      phase: "transcribing",
      progress: Math.round((completedUnits / totalUnits) * 70),
      errorMessage: undefined,
    });
    for (let unit = completedUnits; unit < totalUnits; unit += 1) {
      if (signal.aborted) throw new Error("ai_task_paused");
      const offsetMs = unit * TRANSCRIPTION_CHUNK_MS;
      const segments = await this.runtime.transcribeChunk({
        recordingId: record.recordingId,
        filePath: record.filePath,
        offsetMs,
        durationMs: Math.min(TRANSCRIPTION_CHUNK_MS, totalDuration - offsetMs),
        signal,
        resourceMode: runnable.resourceMode,
      });
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
        updatedAt: new Date().toISOString(),
      });
    }
    return record;
  }

  private async organize(
    record: VoiceMemoryRecord,
    manual: boolean,
    signal: AbortSignal,
  ): Promise<VoiceMemoryRecord> {
    if (record.transcript.length === 0) return record;
    const runnable = this.models.canRunTask("summary", manual);
    if (!runnable.runnable) throw new Error(runnable.reason);
    this.models.markQwenTaskStarted(`organize:${record.recordingId}`);
    record = await this.save({
      ...record,
      phase: "organizing",
      progress: 75,
      errorMessage: undefined,
    });
    try {
      const result = await this.runtime.generateJson<OrganizedResult>({
        resourceMode: runnable.resourceMode,
        maxNewTokens: 900,
        signal,
        prompt: [
          "你是上号语音软件的本地整理助手。这里是固定好友的日常聊天，不是会议。",
          "请生成自然、有趣、能回到原录音的结构化结果。不要写会议背景、议程、待办或企业话术。",
          "严格返回一个 JSON 对象，字段：summary（text/sourceStartMs/sourceSegmentIds），chapters（id/startMs/title/description），highlights（id/title/startMs/endMs/description/transcriptSegmentIds/exportable），markerTitles（markerId/offsetMs/title）。",
          "章节数量随内容和时长决定；精彩片段只选择真正值得回看的内容；不要编造原文没有的信息。",
          `已有标记：${record.markerTitles.map((marker) => `${marker.markerId}@${marker.offsetMs}ms`).join(", ") || "无"}`,
          `录音：${path.basename(record.filePath)}`,
          transcriptForPrompt(record, 12_000),
        ].join("\n"),
      });
      return this.save({
        ...record,
        summary: Array.isArray(result.summary) ? result.summary : [],
        chapters: Array.isArray(result.chapters) ? result.chapters : [],
        highlights: Array.isArray(result.highlights) ? result.highlights : [],
        markerTitles: Array.isArray(result.markerTitles)
          ? result.markerTitles
          : record.markerTitles,
        timeline: [
          ...record.timeline
            .filter((entry) => entry.kind === "marker")
            .map((entry) => ({
              ...entry,
              title:
                (Array.isArray(result.markerTitles) ? result.markerTitles : []).find(
                  (marker) => marker.markerId === entry.id,
                )?.title ?? entry.title,
            })),
          ...(Array.isArray(result.chapters) ? result.chapters : []).map((chapter) => ({
            id: chapter.id || randomUUID(),
            kind: "chapter" as const,
            offsetMs: chapter.startMs,
            title: chapter.title,
            detail: chapter.description,
          })),
          ...(Array.isArray(result.highlights) ? result.highlights : []).map((highlight) => ({
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
    } finally {
      this.models.markAiTaskFinished();
    }
  }

  private async refreshRuntimeStatus(): Promise<void> {
    const status = await this.runtime.status();
    this.models.setRuntimeStatus("vibevoice", status.vibevoice.ready, status.vibevoice.message);
    this.models.setRuntimeStatus("qwen35-4b", status.qwen.ready, status.qwen.message);
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
    return record;
  }

  private async save(record: VoiceMemoryRecord): Promise<VoiceMemoryRecord> {
    if (this.deletedRecordings.has(record.recordingId)) throw new Error("voice_memory_deleted");
    const saved = await this.store.save(record);
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
