import {
  AI_ASR_MODEL_NAMES,
  type AiAsrModelId,
  type AiModelStatus,
  type RecordingLibraryItem,
  type VoiceMemoryRecord,
} from "@private-voice/shared";

export type ModelComparisonPhase =
  | "waiting"
  | "loading"
  | "transcribing"
  | "paused"
  | "releasing"
  | "success"
  | "partial"
  | "stuck"
  | "failed"
  | "user-stopped";

export interface ModelComparisonResult {
  modelId: AiAsrModelId;
  status: "success" | "partial" | "failed" | "paused" | "user-stopped";
  phase: ModelComparisonPhase;
  elapsedMs: number;
  processedAudioMs?: number;
  coveredAudioMs?: number;
  coveragePercent?: number;
  completedUnits?: number;
  totalUnits?: number;
  failedUnits?: number;
  retryCount?: number;
  segmentCount?: number;
  speakerCount?: number;
  heartbeatAt?: string;
  message?: string;
}

export interface ModelComparisonJobSnapshot {
  recordingId: string;
  modelIds: AiAsrModelId[];
  currentIndex: number;
  /** Progress of the model currently being tested, from 0 to 1. */
  currentProgress: number;
  currentPhase: ModelComparisonPhase;
  lastHeartbeatAt?: string;
  phase: "running" | "paused" | "stopped" | "complete";
  results: Partial<Record<AiAsrModelId, ModelComparisonResult>>;
  recovered?: boolean;
  error?: string;
}

interface StoredModelComparisonJob {
  version: 1 | 2;
  recordingId: string;
  modelIds: AiAsrModelId[];
  currentIndex: number;
  phase: "running" | "paused" | "stopped";
  currentProgress: number;
  currentPhase: ModelComparisonPhase;
  lastHeartbeatAt?: string;
  results: Partial<Record<AiAsrModelId, ModelComparisonResult>>;
  updatedAt: number;
}

interface ActiveModelComparisonJob extends ModelComparisonJobSnapshot {
  token: number;
  running: boolean;
  stopRequested: boolean;
  pauseRequested: boolean;
  activeTaskId?: string;
  heartbeatTimer?: number;
}

const clampProgress = (value: number): number => Math.max(0, Math.min(1, value));

const recordProgress = (record: VoiceMemoryRecord): number => {
  if (record.phase === "ready" || record.phase === "error") return 1;
  return clampProgress((record.progress ?? 0) / 70);
};

const storageKey = (recordingId: string): string =>
  `shanghao.recording-model-comparison-run.${recordingId}`;

const isKnownModelId = (value: string): value is AiAsrModelId =>
  Object.prototype.hasOwnProperty.call(AI_ASR_MODEL_NAMES, value);

const readStoredResults = (
  value: unknown,
): Partial<Record<AiAsrModelId, ModelComparisonResult>> => {
  if (!value || typeof value !== "object") return {};
  const results: Partial<Record<AiAsrModelId, ModelComparisonResult>> = {};
  for (const [modelId, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!isKnownModelId(modelId) || !candidate || typeof candidate !== "object") continue;
    const result = candidate as Partial<ModelComparisonResult>;
    if (
      result.modelId !== modelId ||
      !["success", "partial", "failed", "paused", "user-stopped"].includes(
        result.status as string,
      ) ||
      typeof result.elapsedMs !== "number" ||
      !Number.isFinite(result.elapsedMs)
    )
      continue;
    results[modelId] = {
      modelId,
      status: result.status!,
      phase:
        typeof result.phase === "string"
          ? result.phase
          : result.status === "success"
            ? "success"
            : result.status === "partial"
              ? "partial"
              : result.status === "paused"
                ? "paused"
                : "failed",
      elapsedMs: Math.max(0, result.elapsedMs),
      processedAudioMs:
        typeof result.processedAudioMs === "number"
          ? Math.max(0, result.processedAudioMs)
          : undefined,
      coveredAudioMs:
        typeof result.coveredAudioMs === "number" ? Math.max(0, result.coveredAudioMs) : undefined,
      coveragePercent:
        typeof result.coveragePercent === "number"
          ? Math.max(0, Math.min(100, result.coveragePercent))
          : undefined,
      completedUnits:
        typeof result.completedUnits === "number"
          ? Math.max(0, Math.floor(result.completedUnits))
          : undefined,
      totalUnits:
        typeof result.totalUnits === "number"
          ? Math.max(0, Math.floor(result.totalUnits))
          : undefined,
      failedUnits:
        typeof result.failedUnits === "number"
          ? Math.max(0, Math.floor(result.failedUnits))
          : undefined,
      retryCount:
        typeof result.retryCount === "number"
          ? Math.max(0, Math.floor(result.retryCount))
          : undefined,
      segmentCount:
        typeof result.segmentCount === "number"
          ? Math.max(0, Math.floor(result.segmentCount))
          : undefined,
      speakerCount:
        typeof result.speakerCount === "number"
          ? Math.max(0, Math.floor(result.speakerCount))
          : undefined,
      heartbeatAt: typeof result.heartbeatAt === "string" ? result.heartbeatAt : undefined,
      message: typeof result.message === "string" ? result.message : undefined,
    };
  }
  return results;
};

const readStoredJob = (recordingId: string): StoredModelComparisonJob | undefined => {
  try {
    const raw = window.localStorage.getItem(storageKey(recordingId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredModelComparisonJob>;
    const modelIds = Array.isArray(parsed.modelIds)
      ? parsed.modelIds.filter(
          (modelId): modelId is AiAsrModelId =>
            typeof modelId === "string" && isKnownModelId(modelId),
        )
      : [];
    if (
      (parsed.version !== 1 && parsed.version !== 2) ||
      parsed.recordingId !== recordingId ||
      !modelIds.length ||
      typeof parsed.currentIndex !== "number" ||
      !Number.isInteger(parsed.currentIndex) ||
      parsed.currentIndex < 0 ||
      parsed.currentIndex > modelIds.length ||
      !parsed.phase
    ) {
      return undefined;
    }
    return {
      version: 2,
      recordingId,
      modelIds,
      currentIndex: parsed.currentIndex,
      phase: parsed.phase,
      currentPhase:
        typeof parsed.currentPhase === "string"
          ? parsed.currentPhase
          : parsed.phase === "running"
            ? "transcribing"
            : parsed.phase === "paused"
              ? "paused"
              : "user-stopped",
      currentProgress:
        parsed.version === 2 && typeof parsed.currentProgress === "number"
          ? clampProgress(parsed.currentProgress)
          : 0,
      results: parsed.version === 2 ? readStoredResults(parsed.results) : {},
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return undefined;
  }
};

const persistJob = (job: ActiveModelComparisonJob): void => {
  try {
    const stored: StoredModelComparisonJob = {
      version: 2,
      recordingId: job.recordingId,
      modelIds: job.modelIds,
      currentIndex: job.currentIndex,
      phase: job.phase === "complete" ? "stopped" : job.phase,
      currentPhase: job.currentPhase,
      lastHeartbeatAt: job.lastHeartbeatAt,
      currentProgress: clampProgress(job.currentProgress),
      results: job.results,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(storageKey(job.recordingId), JSON.stringify(stored));
  } catch {
    // The recording variants remain the source of truth when localStorage is unavailable.
  }
};

const clearPersistedJob = (recordingId: string): void => {
  try {
    window.localStorage.removeItem(storageKey(recordingId));
  } catch {
    // Best effort only; completed variants are already persisted by the main process.
  }
};

const isTerminal = (record: VoiceMemoryRecord): boolean =>
  (record.phase === "ready" || record.phase === "error" || record.phase === "paused") &&
  record.taskStatus !== "processing";

const hasSavedVariant = (record: VoiceMemoryRecord | undefined, modelId: AiAsrModelId): boolean =>
  Boolean(
    record?.transcriptionVariants?.[modelId] ||
    (record?.transcriptionModel?.id === modelId && record.transcript.length > 0),
  );

const taskMatches = (record: VoiceMemoryRecord, taskId: string): boolean =>
  record.taskId === taskId;

const COMPARISON_WATCHDOG_MS = 10 * 60_000;

const waitForTerminal = (recordingId: string, taskId: string): Promise<VoiceMemoryRecord> =>
  new Promise((resolve, reject) => {
    let finished = false;
    let unsubscribe: () => void = () => undefined;
    const timer = {
      poll: undefined as number | undefined,
      watchdog: undefined as number | undefined,
    };
    const finish = (next: VoiceMemoryRecord) => {
      if (finished) return;
      finished = true;
      unsubscribe();
      if (timer.poll !== undefined) window.clearInterval(timer.poll);
      if (timer.watchdog !== undefined) window.clearTimeout(timer.watchdog);
      resolve(next);
    };
    const fail = (cause: Error) => {
      if (finished) return;
      finished = true;
      unsubscribe();
      if (timer.poll !== undefined) window.clearInterval(timer.poll);
      if (timer.watchdog !== undefined) window.clearTimeout(timer.watchdog);
      reject(cause);
    };
    const inspect = (next: VoiceMemoryRecord | undefined) => {
      if (next && taskMatches(next, taskId) && isTerminal(next)) finish(next);
    };
    unsubscribe = window.desktopApi.ai.onVoiceMemoryStatus((next) => {
      if (next.recordingId === recordingId) inspect(next);
    });
    const poll = () => {
      void window.desktopApi.ai
        .getVoiceMemory(recordingId)
        .then(inspect)
        .catch(() => undefined);
    };
    timer.poll = window.setInterval(poll, 1_000);
    timer.watchdog = window.setTimeout(
      () => fail(new Error("transcription_stalled")),
      COMPARISON_WATCHDOG_MS,
    );
    poll();
  });

const createComparisonTaskId = (recordingId: string, modelId: AiAsrModelId): string =>
  `model-comparison:${recordingId}:${modelId}:${Date.now()}:${crypto.randomUUID()}`;

const recordFailureMessage = (record: VoiceMemoryRecord): string | undefined =>
  record.errorMessage ?? record.diagnostic?.errorMessage;

const isRetryableMessage = (message: string): boolean =>
  /(?:asr|qwen)_worker_(?:idle_release|timeout|exit_|load_timeout)|transcription_checkpoint_(?:missing|incompatible)/i.test(
    message,
  );

const isRetryableFailure = (record: VoiceMemoryRecord): boolean => {
  if (record.phase === "paused") return true;
  const message = recordFailureMessage(record) ?? "";
  return isRetryableMessage(message);
};

const formatError = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : "";
  if (message === "transcription_stalled") {
    return "当前模型长时间没有进展，已暂停；可以点击继续测试。";
  }
  return message || "模型测试没有完成";
};

export class ModelComparisonQueue {
  private readonly jobs = new Map<string, ActiveModelComparisonJob>();
  private readonly listeners = new Map<
    string,
    Set<(job: ModelComparisonJobSnapshot | undefined) => void>
  >();
  private sequence = 0;
  private voiceStatusUnsubscribe?: () => void;

  get(recordingId: string): ModelComparisonJobSnapshot | undefined {
    const active = this.jobs.get(recordingId);
    if (active) return this.snapshot(active);
    const stored = readStoredJob(recordingId);
    if (!stored) return undefined;
    return {
      recordingId: stored.recordingId,
      modelIds: stored.modelIds,
      currentIndex: stored.currentIndex,
      phase: stored.phase === "running" ? "paused" : stored.phase,
      currentProgress: stored.currentProgress,
      currentPhase: stored.currentPhase,
      lastHeartbeatAt: stored.lastHeartbeatAt,
      results: stored.results,
      recovered: stored.phase === "running",
    };
  }

  subscribe(
    recordingId: string,
    listener: (job: ModelComparisonJobSnapshot | undefined) => void,
  ): () => void {
    const listeners = this.listeners.get(recordingId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(recordingId, listeners);
    listener(this.get(recordingId));
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(recordingId);
    };
  }

  start(recording: RecordingLibraryItem, models: AiModelStatus[]): void {
    if (!models.length) return;
    this.ensureVoiceStatusSubscription();
    const existing = this.jobs.get(recording.recordingId);
    if (existing?.running) return;
    const persisted = readStoredJob(recording.recordingId);
    if (
      !existing &&
      persisted &&
      persisted.phase !== "stopped" &&
      persisted.currentIndex < persisted.modelIds.length
    ) {
      // A page remount or app restart must not discard a durable comparison run. The
      // explicit clear action remains the way to abandon it and start from scratch.
      this.resume(recording, models);
      return;
    }
    const job = this.createJob(
      recording.recordingId,
      models.map((model) => model.id as AiAsrModelId),
    );
    this.jobs.set(recording.recordingId, job);
    this.notify(job);
    void this.run(job, recording, models, 0, false);
  }

  resume(recording: RecordingLibraryItem, models: AiModelStatus[]): void {
    this.ensureVoiceStatusSubscription();
    const available = new Map(models.map((model) => [model.id as AiAsrModelId, model]));
    const existing = this.jobs.get(recording.recordingId);
    const stored = existing ?? this.createRecoveredJob(recording.recordingId);
    if (!stored || stored.running) return;
    const modelIds = stored.modelIds.filter((modelId) => available.has(modelId));
    if (!modelIds.length || stored.currentIndex >= modelIds.length) return;
    stored.modelIds = modelIds;
    stored.phase = "running";
    stored.recovered = false;
    stored.error = undefined;
    stored.stopRequested = false;
    stored.pauseRequested = false;
    stored.currentProgress = 0;
    stored.currentPhase = "waiting";
    stored.lastHeartbeatAt = new Date().toISOString();
    this.jobs.set(recording.recordingId, stored);
    this.notify(stored);
    void this.run(
      stored,
      recording,
      modelIds
        .map((modelId) => available.get(modelId))
        .filter((model): model is AiModelStatus => Boolean(model)),
      stored.currentIndex,
      true,
    );
  }

  rerun(recording: RecordingLibraryItem, model: AiModelStatus): void {
    this.start(recording, [model]);
  }

  async pause(recordingId: string): Promise<void> {
    const job = this.jobs.get(recordingId);
    if (!job?.running) return;
    job.pauseRequested = true;
    await window.desktopApi.ai.pauseTask(recordingId);
  }

  async stop(recordingId: string): Promise<void> {
    const job = this.jobs.get(recordingId);
    if (!job?.running) return;
    job.stopRequested = true;
    await window.desktopApi.ai.pauseTask(recordingId);
  }

  clear(recordingId: string): void {
    const job = this.jobs.get(recordingId);
    if (job?.running) return;
    this.jobs.delete(recordingId);
    clearPersistedJob(recordingId);
    this.notify(undefined, recordingId);
  }

  private createJob(recordingId: string, modelIds: AiAsrModelId[]): ActiveModelComparisonJob {
    return {
      recordingId,
      modelIds,
      currentIndex: 0,
      currentProgress: 0,
      phase: "running",
      currentPhase: "waiting",
      lastHeartbeatAt: new Date().toISOString(),
      results: {},
      recovered: false,
      token: ++this.sequence,
      running: false,
      stopRequested: false,
      pauseRequested: false,
    };
  }

  private createRecoveredJob(recordingId: string): ActiveModelComparisonJob | undefined {
    const stored = readStoredJob(recordingId);
    if (!stored) return undefined;
    return {
      recordingId,
      modelIds: stored.modelIds,
      currentIndex: stored.currentIndex,
      currentProgress: stored.currentProgress,
      currentPhase: stored.currentPhase,
      lastHeartbeatAt: stored.lastHeartbeatAt,
      phase: stored.phase === "running" ? "paused" : stored.phase,
      results: stored.results,
      recovered: stored.phase === "running",
      token: ++this.sequence,
      running: false,
      stopRequested: false,
      pauseRequested: false,
    };
  }

  private async run(
    job: ActiveModelComparisonJob,
    recording: RecordingLibraryItem,
    models: AiModelStatus[],
    startIndex: number,
    resumeCurrent: boolean,
  ): Promise<void> {
    if (job.running) return;
    job.running = true;
    job.heartbeatTimer = window.setInterval(() => this.notify(job), 2_000);
    const token = job.token;
    const available = new Map(models.map((model) => [model.id as AiAsrModelId, model]));
    try {
      for (let index = startIndex; index < job.modelIds.length; index += 1) {
        if (job.token !== token || job.stopRequested) break;
        const modelId = job.modelIds[index];
        if (!modelId || !available.has(modelId)) continue;
        job.currentIndex = index;
        job.currentProgress = 0;
        job.currentPhase = "waiting";
        job.lastHeartbeatAt = new Date().toISOString();
        job.error = undefined;
        persistJob(job);
        this.notify(job);
        const startedAt = performance.now();
        try {
          const currentRecord =
            resumeCurrent && index === startIndex
              ? await window.desktopApi.ai.getVoiceMemory(recording.recordingId)
              : undefined;
          if (currentRecord && hasSavedVariant(currentRecord, modelId)) {
            job.currentIndex = index + 1;
            job.currentProgress = 1;
            resumeCurrent = false;
            persistJob(job);
            this.notify(job);
            continue;
          }
          const resumeThisModel = resumeCurrent && index === startIndex;
          const resumeHasStaleTranscript = Boolean(
            currentRecord &&
            currentRecord.transcript.length > 0 &&
            currentRecord.transcriptionModel?.id !== modelId,
          );
          let completed: VoiceMemoryRecord | undefined;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              const taskId = createComparisonTaskId(recording.recordingId, modelId);
              const accepted = await window.desktopApi.ai.processRecording({
                recordingId: recording.recordingId,
                filePath: recording.filePath,
                roomId: recording.roomId,
                roomName: recording.roomId === "side" ? "二号房" : "一号房",
                manual: true,
                transcribe: true,
                organize: false,
                restartTranscription: attempt > 0 || !resumeThisModel || resumeHasStaleTranscript,
                asrModelId: modelId,
                taskId,
                markers: recording.markers.map((marker) => ({
                  id: marker.id,
                  offsetMs: marker.offsetMs,
                })),
              });
              this.updateJobFromRecord(job, accepted);
              job.currentProgress = recordProgress(accepted);
              job.activeTaskId = taskId;
              persistJob(job);
              this.notify(job);
              completed =
                taskMatches(accepted, taskId) && isTerminal(accepted)
                  ? accepted
                  : await waitForTerminal(recording.recordingId, taskId);
              this.updateJobFromRecord(job, completed);
              if (
                attempt === 0 &&
                !job.pauseRequested &&
                !job.stopRequested &&
                isRetryableFailure(completed)
              ) {
                await new Promise((resolve) => window.setTimeout(resolve, 1_000));
                continue;
              }
              break;
            } catch (cause) {
              if (
                attempt === 0 &&
                !job.pauseRequested &&
                !job.stopRequested &&
                isRetryableMessage(formatError(cause))
              ) {
                await new Promise((resolve) => window.setTimeout(resolve, 1_000));
                continue;
              }
              throw cause;
            }
          }
          if (!completed) throw new Error("模型测试没有返回结果");
          // The token is a local cancellation marker, not a credential.
          // eslint-disable-next-line security/detect-possible-timing-attacks
          if (job.token !== token) return;
          const stats = completed.transcriptionStats;
          const coveragePercent = stats
            ? Math.max(
                0,
                Math.min(
                  100,
                  stats.audioDurationMs > 0
                    ? (stats.coveredAudioMs / stats.audioDurationMs) * 100
                    : 0,
                ),
              )
            : undefined;
          const success =
            completed.phase === "ready" &&
            completed.taskStatus === "success" &&
            completed.transcript.length > 0 &&
            (coveragePercent === undefined || coveragePercent >= 98);
          const partial =
            completed.phase === "ready" &&
            completed.transcript.length > 0 &&
            (completed.taskStatus === "failed" ||
              (coveragePercent !== undefined && coveragePercent < 98));
          const failureMessage = recordFailureMessage(completed);
          const status =
            completed.phase === "paused"
              ? job.stopRequested
                ? "user-stopped"
                : "paused"
              : success
                ? "success"
                : partial
                  ? "partial"
                  : "failed";
          job.results[modelId] = {
            modelId,
            status,
            phase: status,
            elapsedMs:
              completed.transcriptionElapsedMs ?? Math.round(performance.now() - startedAt),
            processedAudioMs: stats?.processedAudioMs,
            coveredAudioMs: stats?.coveredAudioMs,
            coveragePercent,
            completedUnits: stats?.completedUnits,
            totalUnits: stats?.totalUnits,
            failedUnits: stats?.failedUnits,
            retryCount: stats?.retryCount,
            segmentCount: stats?.segmentCount ?? completed.transcript.length,
            speakerCount: stats?.speakerCount ?? completed.speakers.length,
            heartbeatAt: stats?.lastHeartbeatAt ?? completed.diagnostic?.updatedAt,
            message:
              failureMessage ??
              (partial
                ? `部分完成：${stats?.failedUnits ?? 0} 个音频分块未完成，覆盖率 ${coveragePercent?.toFixed(1)}%。`
                : undefined),
          };
          job.activeTaskId = undefined;
          job.currentPhase = "releasing";
          job.currentProgress = completed.phase === "paused" ? recordProgress(completed) : 1;
          if (completed.phase === "paused") {
            job.phase = job.stopRequested ? "stopped" : "paused";
            job.recovered = !job.pauseRequested;
            job.error = failureMessage;
            persistJob(job);
            this.notify(job);
            return;
          }
          job.currentIndex = index + 1;
          job.currentProgress = 0;
          resumeCurrent = false;
          persistJob(job);
          this.notify(job);
        } catch (cause) {
          if (cause instanceof Error && cause.message === "transcription_stalled") {
            // The watchdog must never let the next model start while the previous main-process
            // task is still alive. Abort it, keep the current index, and let Resume continue from
            // the durable per-unit manifest instead of creating overlapping ASR workers.
            job.pauseRequested = true;
            await window.desktopApi.ai.pauseTask(recording.recordingId).catch(() => undefined);
            const pausedRecord = await window.desktopApi.ai
              .getVoiceMemory(recording.recordingId)
              .catch(() => undefined);
            if (pausedRecord) {
              this.updateJobFromRecord(job, pausedRecord);
              job.currentProgress = recordProgress(pausedRecord);
              const stats = pausedRecord.transcriptionStats;
              job.results[modelId] = {
                modelId,
                status: "paused",
                phase: "stuck",
                elapsedMs:
                  pausedRecord.transcriptionElapsedMs ?? Math.round(performance.now() - startedAt),
                processedAudioMs: stats?.processedAudioMs,
                coveredAudioMs: stats?.coveredAudioMs,
                coveragePercent:
                  stats && stats.audioDurationMs > 0
                    ? (stats.coveredAudioMs / stats.audioDurationMs) * 100
                    : undefined,
                completedUnits: stats?.completedUnits,
                totalUnits: stats?.totalUnits,
                failedUnits: stats?.failedUnits,
                retryCount: stats?.retryCount,
                message: "当前模型长时间没有进展，已暂停；可以点击继续测试。",
              };
            }
            job.activeTaskId = undefined;
            job.currentPhase = "stuck";
            job.phase = "paused";
            job.error = "当前模型长时间没有进展，已暂停；可以点击继续测试。";
            persistJob(job);
            this.notify(job);
            return;
          }
          job.activeTaskId = undefined;
          job.currentPhase = "failed";
          job.currentProgress = 1;
          const message = formatError(cause);
          job.results[modelId] = {
            modelId,
            status: "failed",
            phase: "failed",
            elapsedMs: 0,
            message,
          };
          job.error = message;
          job.currentIndex = index + 1;
          resumeCurrent = false;
          persistJob(job);
          this.notify(job);
        }
      }
      if (job.token === token && !job.stopRequested) {
        job.currentIndex = job.modelIds.length;
        job.phase = "complete";
        clearPersistedJob(job.recordingId);
        this.notify(job);
        // The token is a local cancellation marker, not a credential.
        // eslint-disable-next-line security/detect-possible-timing-attacks
      } else if (job.token === token) {
        job.currentPhase = "user-stopped";
        job.phase = "stopped";
        persistJob(job);
        this.notify(job);
      }
    } finally {
      if (job.heartbeatTimer !== undefined) window.clearInterval(job.heartbeatTimer);
      job.heartbeatTimer = undefined;
      job.running = false;
    }
  }

  private snapshot(job: ActiveModelComparisonJob): ModelComparisonJobSnapshot {
    return {
      recordingId: job.recordingId,
      modelIds: [...job.modelIds],
      currentIndex: job.currentIndex,
      currentProgress: clampProgress(job.currentProgress),
      currentPhase:
        job.running && job.lastHeartbeatAt && Date.now() - Date.parse(job.lastHeartbeatAt) > 120_000
          ? "stuck"
          : job.currentPhase,
      lastHeartbeatAt: job.lastHeartbeatAt,
      phase: job.phase,
      results: { ...job.results },
      recovered: job.recovered,
      error: job.error,
    };
  }

  private ensureVoiceStatusSubscription(): void {
    if (this.voiceStatusUnsubscribe) return;
    this.voiceStatusUnsubscribe = window.desktopApi.ai.onVoiceMemoryStatus((record) => {
      const job = this.jobs.get(record.recordingId);
      if (!job?.running || !job.activeTaskId || record.taskId !== job.activeTaskId) return;
      const heartbeat = record.diagnostic?.updatedAt ?? record.updatedAt;
      const heartbeatChanged = heartbeat !== job.lastHeartbeatAt;
      this.updateJobFromRecord(job, record);
      const nextProgress = recordProgress(record);
      if (Math.abs(nextProgress - job.currentProgress) < 0.005 && !heartbeatChanged) return;
      job.currentProgress = nextProgress;
      persistJob(job);
      this.notify(job);
    });
  }

  private updateJobFromRecord(job: ActiveModelComparisonJob, record: VoiceMemoryRecord): void {
    const stage = record.processingStage ?? record.diagnostic?.stage;
    if (record.phase === "paused") job.currentPhase = "paused";
    else if (record.phase === "error") job.currentPhase = "failed";
    else if (record.phase === "ready") job.currentPhase = "releasing";
    else if (stage === "preprocess" || stage === "audio_file") job.currentPhase = "loading";
    else if (record.taskStatus === "processing") job.currentPhase = "transcribing";
    else job.currentPhase = "waiting";
    const heartbeat = record.diagnostic?.updatedAt ?? record.updatedAt;
    if (heartbeat) job.lastHeartbeatAt = heartbeat;
  }

  private notify(job: ActiveModelComparisonJob | undefined, recordingId = job?.recordingId): void {
    if (!recordingId) return;
    const snapshot = job ? this.snapshot(job) : undefined;
    for (const listener of this.listeners.get(recordingId) ?? []) listener(snapshot);
  }
}

export const modelComparisonQueue = new ModelComparisonQueue();
