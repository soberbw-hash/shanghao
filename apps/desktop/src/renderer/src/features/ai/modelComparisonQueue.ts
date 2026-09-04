import {
  AI_ASR_MODEL_NAMES,
  evaluateVoiceMemoryTranscriptionValidity,
  type AiAsrModelId,
  type AiModelStatus,
  type RecordingLibraryItem,
  type VoiceMemoryRecord,
  type VoiceMemoryBenchmarkMode,
} from "@private-voice/shared";

import {
  areVoiceMemoryStatsComplete,
  isVoiceMemoryTranscriptionComplete,
  voiceMemoryTranscriptionPercent,
} from "./voiceMemoryPresentation";

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
  /** Only present after this model completed successfully. */
  elapsedMs?: number;
  processedAudioMs?: number;
  coveredAudioMs?: number;
  taskProgressPercent?: number;
  processedSpeechPercent?: number;
  speechRatioPercent?: number;
  speechCoveragePercent?: number;
  /** Legacy alias retained for old persisted jobs. */
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
  benchmarkMode?: VoiceMemoryBenchmarkMode;
  recovered?: boolean;
  error?: string;
}

export const DEFAULT_MODEL_COMPARISON_BENCHMARK_MODE: VoiceMemoryBenchmarkMode = "long";

/**
 * Installation and runtime preparation are deliberately separate. Runtime discovery is lazy so
 * opening the recording library never has to start Python/CUDA just to decide whether a model can
 * be selected. The queue prepares an installed model immediately before its turn begins.
 */
export const isSelectableModelComparisonModel = (model: AiModelStatus): boolean =>
  model.category === "asr" && Boolean(model.activeRevision);

interface StoredModelComparisonJob {
  version: 1 | 2 | 3 | 4 | 5;
  recordingId: string;
  modelIds: AiAsrModelId[];
  currentIndex: number;
  phase: "running" | "paused" | "stopped";
  currentProgress: number;
  currentPhase: ModelComparisonPhase;
  lastHeartbeatAt?: string;
  results: Partial<Record<AiAsrModelId, ModelComparisonResult>>;
  benchmarkMode?: VoiceMemoryBenchmarkMode;
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
  return clampProgress(voiceMemoryTranscriptionPercent(record) / 100);
};

const storageKey = (recordingId: string): string =>
  `shanghao.recording-model-comparison-run.${recordingId}`;
const STORAGE_KEY_PREFIX = "shanghao.recording-model-comparison-run.";

export const isSupportedModelComparisonStorageVersion = (
  value: unknown,
): value is StoredModelComparisonJob["version"] =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5;

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
      (result.elapsedMs !== undefined &&
        (typeof result.elapsedMs !== "number" || !Number.isFinite(result.elapsedMs)))
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
      elapsedMs: typeof result.elapsedMs === "number" ? Math.max(0, result.elapsedMs) : undefined,
      processedAudioMs:
        typeof result.processedAudioMs === "number"
          ? Math.max(0, result.processedAudioMs)
          : undefined,
      coveredAudioMs:
        typeof result.coveredAudioMs === "number" ? Math.max(0, result.coveredAudioMs) : undefined,
      taskProgressPercent:
        typeof result.taskProgressPercent === "number"
          ? Math.max(0, Math.min(100, result.taskProgressPercent))
          : undefined,
      processedSpeechPercent:
        typeof result.processedSpeechPercent === "number"
          ? Math.max(0, Math.min(100, result.processedSpeechPercent))
          : undefined,
      speechRatioPercent:
        typeof result.speechRatioPercent === "number"
          ? Math.max(0, Math.min(100, result.speechRatioPercent))
          : undefined,
      speechCoveragePercent:
        typeof result.speechCoveragePercent === "number"
          ? Math.max(0, Math.min(100, result.speechCoveragePercent))
          : undefined,
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
      !isSupportedModelComparisonStorageVersion(parsed.version) ||
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
    const benchmarkMode =
      parsed.version < 4 &&
      (parsed.benchmarkMode === undefined || parsed.benchmarkMode === "standard")
        ? DEFAULT_MODEL_COMPARISON_BENCHMARK_MODE
        : parsed.benchmarkMode === "smoke" ||
            parsed.benchmarkMode === "standard" ||
            parsed.benchmarkMode === "long"
          ? parsed.benchmarkMode
          : DEFAULT_MODEL_COMPARISON_BENCHMARK_MODE;
    return {
      version: 5,
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
        parsed.version !== 1 && typeof parsed.currentProgress === "number"
          ? clampProgress(parsed.currentProgress)
          : 0,
      results: parsed.version !== 1 ? readStoredResults(parsed.results) : {},
      benchmarkMode,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return undefined;
  }
};

const persistJob = (job: ActiveModelComparisonJob): void => {
  try {
    const stored: StoredModelComparisonJob = {
      version: 5,
      recordingId: job.recordingId,
      modelIds: job.modelIds,
      currentIndex: job.currentIndex,
      phase: job.phase === "complete" ? "stopped" : job.phase,
      currentPhase: job.currentPhase,
      lastHeartbeatAt: job.lastHeartbeatAt,
      currentProgress: clampProgress(job.currentProgress),
      results: job.results,
      benchmarkMode: job.benchmarkMode,
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

const recoverInterruptedJob = (
  stored: StoredModelComparisonJob,
): { stored: StoredModelComparisonJob; recovered: boolean } => {
  if (stored.phase !== "running") return { stored, recovered: false };
  const paused: StoredModelComparisonJob = {
    ...stored,
    phase: "paused",
    currentPhase: "paused",
    updatedAt: Date.now(),
  };
  try {
    window.localStorage.setItem(storageKey(stored.recordingId), JSON.stringify(paused));
  } catch {
    // The main process also recovers interrupted work as paused on a full restart.
  }
  return { stored: paused, recovered: true };
};

const isTerminal = (record: VoiceMemoryRecord): boolean =>
  (record.phase === "ready" || record.phase === "error" || record.phase === "paused") &&
  record.taskStatus !== "processing";

const hasCompletedVariant = (
  record: VoiceMemoryRecord | undefined,
  modelId: AiAsrModelId,
): boolean => {
  const variant = record?.transcriptionVariants?.[modelId];
  if (variant) {
    return variant.transcriptionStats
      ? areVoiceMemoryStatsComplete(variant.transcriptionStats)
      : variant.transcript.length > 0;
  }
  return Boolean(
    record?.transcriptionModel?.id === modelId && isVoiceMemoryTranscriptionComplete(record),
  );
};

const isCompletedResult = (result: ModelComparisonResult | undefined): boolean => {
  if (result?.status !== "success") return false;
  if ((result.failedUnits ?? 0) > 0) return false;
  if (
    result.totalUnits !== undefined &&
    (result.completedUnits === undefined || result.completedUnits < result.totalUnits)
  )
    return false;
  if (result.taskProgressPercent !== undefined && result.taskProgressPercent < 100) return false;
  return true;
};

const taskMatches = (record: VoiceMemoryRecord, taskId: string): boolean =>
  record.taskId === taskId;

// A cold local model can spend several minutes loading or inferring one short audio unit,
// especially while another application is using the GPU. The watchdog is only a last-resort
// recovery guard: every durable record heartbeat renews it, so normal long inference is not
// mistaken for a dead task.
const COMPARISON_WATCHDOG_MS = 30 * 60_000;

const waitForTerminal = (recordingId: string, taskId: string): Promise<VoiceMemoryRecord> =>
  new Promise((resolve, reject) => {
    let finished = false;
    let unsubscribe: () => void = () => undefined;
    const timer = {
      poll: undefined as number | undefined,
      watchdog: undefined as number | undefined,
    };
    let lastHeartbeat: string | undefined;
    const armWatchdog = () => {
      if (timer.watchdog !== undefined) window.clearTimeout(timer.watchdog);
      timer.watchdog = window.setTimeout(
        () => fail(new Error("transcription_stalled")),
        COMPARISON_WATCHDOG_MS,
      );
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
      if (!next || !taskMatches(next, taskId)) return;
      const heartbeat = next.diagnostic?.updatedAt ?? next.updatedAt;
      if (heartbeat && heartbeat !== lastHeartbeat) {
        lastHeartbeat = heartbeat;
        armWatchdog();
      }
      if (isTerminal(next)) finish(next);
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
    armWatchdog();
    poll();
  });

const createComparisonTaskId = (recordingId: string, modelId: AiAsrModelId): string =>
  `model-comparison:${recordingId}:${modelId}:${Date.now()}:${crypto.randomUUID()}`;

const recordFailureMessage = (record: VoiceMemoryRecord): string | undefined =>
  record.errorMessage ?? record.diagnostic?.errorMessage;

const isRetryableMessage = (message: string): boolean =>
  !/(?:0xc000001d|-1073741795|3221225501|asr_runtime_fatal)/i.test(message) &&
  /(?:asr|qwen)_worker_(?:idle_release|timeout|exit_|load_timeout)|transcription_checkpoint_(?:missing|incompatible)/i.test(
    message,
  );

const isRetryableFailure = (record: VoiceMemoryRecord): boolean => {
  if (record.phase === "paused") return true;
  const message = recordFailureMessage(record) ?? "";
  return isRetryableMessage(message);
};

const COMPARISON_STALE_MS = 30 * 60_000;

const formatError = (cause: unknown): string => {
  const message = cause instanceof Error ? cause.message : "";
  if (/(?:0xc000001d|-1073741795|3221225501|illegal instruction)/i.test(message)) {
    return "ARK-ASR Q8 原生运行组件不兼容当前 CPU，已停止该模型且保留断点；请先在 AI 功能中修复运行组件。";
  }
  if (
    /(?:unable to compare versions for packaging|no package metadata was found|modulenotfounderror|no module named|importerror:|dll load failed|asr_runtime_fatal)/i.test(
      message,
    )
  ) {
    return "当前模型运行组件损坏或缺少依赖，已停止该模型；请在 AI 功能中修复运行组件。";
  }
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

  constructor() {
    if (typeof window === "undefined") return;
    this.recoverAllInterruptedJobs();
  }

  get(recordingId: string): ModelComparisonJobSnapshot | undefined {
    const active = this.jobs.get(recordingId);
    if (active) return this.snapshot(active);
    const persisted = readStoredJob(recordingId);
    if (!persisted) return undefined;
    const { stored, recovered } = recoverInterruptedJob(persisted);
    return {
      recordingId: stored.recordingId,
      modelIds: stored.modelIds,
      currentIndex: stored.currentIndex,
      phase: stored.phase,
      currentProgress: stored.currentProgress,
      currentPhase: stored.currentPhase,
      lastHeartbeatAt: stored.lastHeartbeatAt,
      results: stored.results,
      benchmarkMode: stored.benchmarkMode,
      recovered,
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

  start(
    recording: RecordingLibraryItem,
    models: AiModelStatus[],
    benchmarkMode: VoiceMemoryBenchmarkMode = DEFAULT_MODEL_COMPARISON_BENCHMARK_MODE,
  ): void {
    if (!models.length) return;
    this.ensureVoiceStatusSubscription();
    const existing = this.jobs.get(recording.recordingId);
    if (existing?.running) return;
    this.jobs.delete(recording.recordingId);
    clearPersistedJob(recording.recordingId);
    const job = this.createJob(
      recording.recordingId,
      models.map((model) => model.id as AiAsrModelId),
      benchmarkMode,
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

  dispose(): void {
    this.voiceStatusUnsubscribe?.();
    this.voiceStatusUnsubscribe = undefined;
    for (const job of this.jobs.values()) {
      if (job.heartbeatTimer !== undefined) window.clearInterval(job.heartbeatTimer);
      job.heartbeatTimer = undefined;
    }
  }

  async clear(recordingId: string): Promise<VoiceMemoryRecord> {
    const job = this.jobs.get(recordingId);
    if (job?.running) throw new Error("请先暂停当前测试，再清除测试结果。");
    const record = await window.desktopApi.ai.clearTranscriptionResults(recordingId);
    this.jobs.delete(recordingId);
    clearPersistedJob(recordingId);
    this.notify(undefined, recordingId);
    return record;
  }

  private createJob(
    recordingId: string,
    modelIds: AiAsrModelId[],
    benchmarkMode: VoiceMemoryBenchmarkMode = DEFAULT_MODEL_COMPARISON_BENCHMARK_MODE,
  ): ActiveModelComparisonJob {
    return {
      recordingId,
      modelIds,
      currentIndex: 0,
      currentProgress: 0,
      phase: "running",
      currentPhase: "waiting",
      lastHeartbeatAt: new Date().toISOString(),
      results: {},
      benchmarkMode,
      recovered: false,
      token: ++this.sequence,
      running: false,
      stopRequested: false,
      pauseRequested: false,
    };
  }

  private createRecoveredJob(recordingId: string): ActiveModelComparisonJob | undefined {
    const persisted = readStoredJob(recordingId);
    if (!persisted) return undefined;
    const { stored, recovered } = recoverInterruptedJob(persisted);
    return {
      recordingId,
      modelIds: stored.modelIds,
      currentIndex: stored.currentIndex,
      currentProgress: stored.currentProgress,
      currentPhase: stored.currentPhase,
      lastHeartbeatAt: stored.lastHeartbeatAt,
      phase: stored.phase,
      results: stored.results,
      benchmarkMode: stored.benchmarkMode,
      recovered,
      token: ++this.sequence,
      running: false,
      stopRequested: false,
      pauseRequested: false,
    };
  }

  private recoverAllInterruptedJobs(): void {
    const recordingIds: string[] = [];
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(STORAGE_KEY_PREFIX)) {
          recordingIds.push(key.slice(STORAGE_KEY_PREFIX.length));
        }
      }
    } catch {
      return;
    }
    for (const recordingId of recordingIds) {
      const stored = readStoredJob(recordingId);
      if (!stored || stored.phase !== "running") continue;
      recoverInterruptedJob(stored);
    }
  }

  private async run(
    job: ActiveModelComparisonJob,
    recording: RecordingLibraryItem,
    models: AiModelStatus[],
    startIndex: number,
    resumeSavedVariants: boolean,
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
        const selectedModel = modelId ? available.get(modelId) : undefined;
        if (!modelId || !selectedModel) continue;
        job.currentIndex = index;
        job.currentProgress = 0;
        job.currentPhase = "waiting";
        job.lastHeartbeatAt = new Date().toISOString();
        job.error = undefined;
        persistJob(job);
        this.notify(job);
        const startedAt = performance.now();
        try {
          if (!selectedModel.runtimeReady) {
            job.currentPhase = "loading";
            persistJob(job);
            this.notify(job);
            const snapshot = await window.desktopApi.ai.controlModel(modelId, "repair");
            for (const snapshotModel of snapshot.models) {
              if (
                snapshotModel.category === "asr" &&
                isKnownModelId(snapshotModel.id) &&
                available.has(snapshotModel.id)
              ) {
                available.set(snapshotModel.id, snapshotModel);
              }
            }
            const preparedModel = snapshot.models.find((model) => model.id === modelId);
            if (!preparedModel?.activeRevision || !preparedModel.runtimeReady) {
              throw new Error(
                preparedModel?.runtimeMessage ?? `${AI_ASR_MODEL_NAMES[modelId]}运行组件尚未就绪`,
              );
            }
            available.set(modelId, preparedModel);
          }
          let currentRecord = resumeSavedVariants
            ? await window.desktopApi.ai.getVoiceMemory(recording.recordingId)
            : undefined;
          if (currentRecord && hasCompletedVariant(currentRecord, modelId)) {
            job.currentIndex = index + 1;
            job.currentProgress = 1;
            persistJob(job);
            this.notify(job);
            continue;
          }
          if (
            resumeSavedVariants &&
            currentRecord?.transcriptionVariants?.[modelId] &&
            currentRecord.transcriptionModel?.id !== modelId
          ) {
            currentRecord = await window.desktopApi.ai.selectTranscription(
              recording.recordingId,
              modelId,
            );
          }
          const resumeThisModel = resumeSavedVariants;
          const resumeHasStaleTranscript = Boolean(
            currentRecord &&
            currentRecord.transcript.length > 0 &&
            currentRecord.transcriptionModel?.id !== modelId,
          );
          let completed: VoiceMemoryRecord | undefined;
          if (
            resumeSavedVariants &&
            currentRecord?.taskStatus === "processing" &&
            currentRecord.transcriptionModel?.id === modelId &&
            currentRecord.taskId?.startsWith("model-comparison:")
          ) {
            // The renderer can reload independently of the durable main-process task. Reattach
            // to that exact task instead of issuing a second request or aborting healthy work.
            job.activeTaskId = currentRecord.taskId;
            this.updateJobFromRecord(job, currentRecord);
            job.currentProgress = recordProgress(currentRecord);
            persistJob(job);
            this.notify(job);
            completed = await waitForTerminal(recording.recordingId, currentRecord.taskId);
          }
          for (let attempt = 0; attempt < 2; attempt += 1) {
            if (completed) break;
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
                benchmark: {
                  mode: job.benchmarkMode ?? DEFAULT_MODEL_COMPARISON_BENCHMARK_MODE,
                },
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
          const coveragePercent = stats?.speechCoveragePercent;
          const validity = evaluateVoiceMemoryTranscriptionValidity(
            stats,
            completed.transcriptionUnits,
          );
          const success =
            completed.phase === "ready" && completed.taskStatus === "success" && validity.complete;
          const partial =
            !success &&
            completed.phase === "ready" &&
            (completed.transcript.length > 0 || (stats?.processedAudioMs ?? 0) > 0) &&
            (completed.taskStatus === "failed" || !validity.complete);
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
              status === "success"
                ? (completed.transcriptionElapsedMs ?? Math.round(performance.now() - startedAt))
                : undefined,
            processedAudioMs: stats?.processedAudioMs,
            coveredAudioMs: stats?.coveredAudioMs,
            taskProgressPercent: stats?.taskProgressPercent,
            processedSpeechPercent: stats?.processedSpeechPercent,
            speechRatioPercent: stats?.speechRatioPercent,
            speechCoveragePercent: stats?.speechCoveragePercent,
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
              (partial ? `部分完成：${stats?.failedUnits ?? 0} 个音频分块未完成。` : undefined),
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
                processedAudioMs: stats?.processedAudioMs,
                coveredAudioMs: stats?.coveredAudioMs,
                taskProgressPercent: stats?.taskProgressPercent,
                processedSpeechPercent: stats?.processedSpeechPercent,
                speechRatioPercent: stats?.speechRatioPercent,
                speechCoveragePercent: stats?.speechCoveragePercent,
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
            message,
          };
          job.error = message;
          job.currentIndex = index + 1;
          persistJob(job);
          this.notify(job);
        }
      }
      if (job.token === token && !job.stopRequested) {
        const latestRecord = await window.desktopApi.ai
          .getVoiceMemory(recording.recordingId)
          .catch(() => undefined);
        const incompleteModelIds = job.modelIds.filter((modelId) => {
          const result = job.results[modelId];
          if (result?.status === "failed" || result?.status === "partial") return false;
          return !isCompletedResult(result) && !hasCompletedVariant(latestRecord, modelId);
        });
        if (incompleteModelIds.length > 0) {
          job.modelIds = incompleteModelIds;
          job.currentIndex = 0;
          job.currentProgress = 0;
          job.currentPhase = "paused";
          job.phase = "paused";
          job.recovered = false;
          job.error = `${incompleteModelIds.length} 个模型尚未完整覆盖音频，已保留断点；点击继续剩余测试。`;
          persistJob(job);
        } else {
          job.currentIndex = job.modelIds.length;
          job.phase = "complete";
          job.error = undefined;
          clearPersistedJob(job.recordingId);
        }
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
        job.running &&
        job.lastHeartbeatAt &&
        Date.now() - Date.parse(job.lastHeartbeatAt) > COMPARISON_STALE_MS
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

interface ModelComparisonHotData {
  queue?: ModelComparisonQueue;
}

const modelComparisonHotData = import.meta.hot?.data as ModelComparisonHotData | undefined;

export const modelComparisonQueue = modelComparisonHotData?.queue ?? new ModelComparisonQueue();

if (import.meta.hot) {
  import.meta.hot.dispose((data: ModelComparisonHotData) => {
    // Keep the active coordinator alive across renderer HMR. The main process owns the durable
    // ASR job, and a visual hot update must not pause or duplicate it.
    data.queue = modelComparisonQueue;
  });
}
