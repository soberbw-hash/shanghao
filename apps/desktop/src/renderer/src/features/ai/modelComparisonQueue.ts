import {
  AI_ASR_MODEL_NAMES,
  type AiAsrModelId,
  type AiModelStatus,
  type RecordingLibraryItem,
  type VoiceMemoryRecord,
} from "@private-voice/shared";

export interface ModelComparisonResult {
  modelId: AiAsrModelId;
  status: "success" | "failed" | "paused";
  elapsedMs: number;
  message?: string;
}

export interface ModelComparisonJobSnapshot {
  recordingId: string;
  modelIds: AiAsrModelId[];
  currentIndex: number;
  phase: "running" | "paused" | "stopped" | "complete";
  results: Partial<Record<AiAsrModelId, ModelComparisonResult>>;
  recovered?: boolean;
  error?: string;
}

interface StoredModelComparisonJob {
  version: 1;
  recordingId: string;
  modelIds: AiAsrModelId[];
  currentIndex: number;
  phase: "running" | "paused" | "stopped";
  updatedAt: number;
}

interface ActiveModelComparisonJob extends ModelComparisonJobSnapshot {
  token: number;
  running: boolean;
  stopRequested: boolean;
  pauseRequested: boolean;
}

const storageKey = (recordingId: string): string =>
  `shanghao.recording-model-comparison-run.${recordingId}`;

const isKnownModelId = (value: string): value is AiAsrModelId =>
  Object.prototype.hasOwnProperty.call(AI_ASR_MODEL_NAMES, value);

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
      parsed.version !== 1 ||
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
      version: 1,
      recordingId,
      modelIds,
      currentIndex: parsed.currentIndex,
      phase: parsed.phase,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return undefined;
  }
};

const persistJob = (job: ActiveModelComparisonJob): void => {
  try {
    const stored: StoredModelComparisonJob = {
      version: 1,
      recordingId: job.recordingId,
      modelIds: job.modelIds,
      currentIndex: job.currentIndex,
      phase: job.phase === "complete" ? "stopped" : job.phase,
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

const waitForTerminal = (recordingId: string, taskId: string): Promise<VoiceMemoryRecord> =>
  new Promise((resolve) => {
    let finished = false;
    let unsubscribe: () => void = () => undefined;
    const timer = { poll: undefined as number | undefined };
    const finish = (next: VoiceMemoryRecord) => {
      if (finished) return;
      finished = true;
      unsubscribe();
      if (timer.poll !== undefined) window.clearInterval(timer.poll);
      resolve(next);
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
    poll();
  });

const createComparisonTaskId = (recordingId: string, modelId: AiAsrModelId): string =>
  `model-comparison:${recordingId}:${modelId}:${Date.now()}:${crypto.randomUUID()}`;

const recordFailureMessage = (record: VoiceMemoryRecord): string | undefined =>
  record.errorMessage ?? record.diagnostic?.errorMessage;

const isRetryableFailure = (record: VoiceMemoryRecord): boolean => {
  if (record.phase === "paused") return true;
  const message = recordFailureMessage(record) ?? "";
  return /(?:asr|qwen)_worker_(?:idle_release|timeout)/.test(message);
};

const formatError = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "模型测试没有完成";

export class ModelComparisonQueue {
  private readonly jobs = new Map<string, ActiveModelComparisonJob>();
  private readonly listeners = new Map<
    string,
    Set<(job: ModelComparisonJobSnapshot | undefined) => void>
  >();
  private sequence = 0;

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
      results: {},
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
    const existing = this.jobs.get(recording.recordingId);
    if (existing?.running) return;
    const job = this.createJob(
      recording.recordingId,
      models.map((model) => model.id as AiAsrModelId),
    );
    this.jobs.set(recording.recordingId, job);
    this.notify(job);
    void this.run(job, recording, models, 0, false);
  }

  resume(recording: RecordingLibraryItem, models: AiModelStatus[]): void {
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
      phase: "running",
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
      phase: stored.phase === "running" ? "paused" : stored.phase,
      results: {},
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
    const token = job.token;
    const available = new Map(models.map((model) => [model.id as AiAsrModelId, model]));
    try {
      for (let index = startIndex; index < job.modelIds.length; index += 1) {
        if (job.token !== token || job.stopRequested) break;
        const modelId = job.modelIds[index];
        if (!modelId || !available.has(modelId)) continue;
        job.currentIndex = index;
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
            resumeCurrent = false;
            persistJob(job);
            this.notify(job);
            continue;
          }
          const resumeThisModel = resumeCurrent && index === startIndex;
          let completed: VoiceMemoryRecord | undefined;
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const taskId = createComparisonTaskId(recording.recordingId, modelId);
            const accepted = await window.desktopApi.ai.processRecording({
              recordingId: recording.recordingId,
              filePath: recording.filePath,
              roomId: recording.roomId,
              roomName: recording.roomId === "side" ? "二号房" : "一号房",
              manual: true,
              transcribe: true,
              organize: false,
              restartTranscription: attempt > 0 || !resumeThisModel,
              asrModelId: modelId,
              taskId,
              markers: recording.markers.map((marker) => ({
                id: marker.id,
                offsetMs: marker.offsetMs,
              })),
            });
            completed =
              taskMatches(accepted, taskId) && isTerminal(accepted)
                ? accepted
                : await waitForTerminal(recording.recordingId, taskId);
            if (
              attempt === 0 &&
              !job.pauseRequested &&
              !job.stopRequested &&
              isRetryableFailure(completed)
            ) {
              continue;
            }
            break;
          }
          if (!completed) throw new Error("模型测试没有返回结果");
          // The token is a local cancellation marker, not a credential.
          // eslint-disable-next-line security/detect-possible-timing-attacks
          if (job.token !== token) return;
          const success = completed.phase === "ready" && completed.transcript.length > 0;
          const failureMessage = recordFailureMessage(completed);
          job.results[modelId] = {
            modelId,
            status: completed.phase === "paused" ? "paused" : success ? "success" : "failed",
            elapsedMs:
              completed.transcriptionElapsedMs ?? Math.round(performance.now() - startedAt),
            message: failureMessage,
          };
          if (completed.phase === "paused") {
            job.phase = job.stopRequested ? "stopped" : "paused";
            job.recovered = !job.pauseRequested;
            job.error = failureMessage;
            persistJob(job);
            this.notify(job);
            return;
          }
          job.currentIndex = index + 1;
          resumeCurrent = false;
          persistJob(job);
          this.notify(job);
        } catch (cause) {
          const message = formatError(cause);
          job.results[modelId] = { modelId, status: "failed", elapsedMs: 0, message };
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
        job.phase = "stopped";
        persistJob(job);
        this.notify(job);
      }
    } finally {
      job.running = false;
    }
  }

  private snapshot(job: ActiveModelComparisonJob): ModelComparisonJobSnapshot {
    return {
      recordingId: job.recordingId,
      modelIds: [...job.modelIds],
      currentIndex: job.currentIndex,
      phase: job.phase,
      results: { ...job.results },
      recovered: job.recovered,
      error: job.error,
    };
  }

  private notify(job: ActiveModelComparisonJob | undefined, recordingId = job?.recordingId): void {
    if (!recordingId) return;
    const snapshot = job ? this.snapshot(job) : undefined;
    for (const listener of this.listeners.get(recordingId) ?? []) listener(snapshot);
  }
}

export const modelComparisonQueue = new ModelComparisonQueue();
