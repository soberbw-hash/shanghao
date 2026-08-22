import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type {
  AiAsrModelId,
  AiModelAction,
  AiModelId,
  AiModelStatus,
  AiProcessingMode,
  AiRuntimePressure,
  AiTaskCheckpoint,
  AiTaskKind,
  AiVoiceMemorySnapshot,
  RendererLogPayload,
} from "@private-voice/shared";

import type { GameDetectionController } from "./game-detection";
import { ResourceScheduler } from "./resource-scheduler";

export {
  GAMING_DOWNLOAD_BYTES_PER_SECOND,
  NORMAL_DOWNLOAD_BYTES_PER_SECOND,
  REALTIME_PRESSURE_DOWNLOAD_BYTES_PER_SECOND,
} from "./resource-scheduler";

interface ModelDefinition {
  id: AiModelId;
  category: "asr" | "organizer";
  name: string;
  purpose: string;
  repository: string;
  revision: string;
  approximateBytes: number;
  components?: readonly ModelComponent[];
}

interface ModelComponent {
  directory: string;
  repository: string;
  revision: string;
}

interface RemoteModelFile {
  rfilename: string;
  size?: number;
}

interface RemoteModelManifest {
  sha: string;
  siblings: RemoteModelFile[];
}

interface DownloadModelFile extends RemoteModelFile {
  sourceFileName: string;
  sourceRepository: string;
  sourceRevision: string;
}

interface ModelSource {
  name: string;
  baseUrl: string;
}

interface PersistedModelState {
  userInstalled: boolean;
  activeRevision?: string;
  pendingRevision?: string;
  phase?: AiModelStatus["phase"];
  downloadedBytes?: number;
  totalBytes?: number;
  errorMessage?: string;
}

interface PersistedAiState {
  models: Partial<Record<AiModelId, PersistedModelState>>;
  taskCheckpoints: Record<string, AiTaskCheckpoint>;
}

const VIBEVOICE_MODEL_REVISION = "66e78021ab8f5f06133d1ab421ba4d348bda97c9";
const QWEN3_ASR_MODEL_REVISION = "7f1569a48a89f3e3f4dc3a5c9d28bddd903bc76c";
const PARAFORMER_MODEL_REVISION = "d7811ee3ac581fbcfdeb37c98c6ba674028433dc";
const FSMN_VAD_MODEL_REVISION = "df20e6b30c653645fa4ff125cacfcabd1020a669";
const CT_PUNC_MODEL_REVISION = "d0e55e2b8722a78b63705ff443d09c4f86e5d750";
const PARAFORMER_BUNDLE_REVISION = "bundle-d7811ee3-df20e6b3-d0e55e2b";
const QWEN_MODEL_REVISION = "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a";

const MODEL_DEFINITIONS: readonly ModelDefinition[] = [
  {
    id: "vibevoice",
    category: "asr",
    name: "VibeVoice-ASR-BitNet",
    purpose: "体积较小，现有兼容方案",
    repository: "microsoft/VibeVoice-ASR-BitNet",
    revision: VIBEVOICE_MODEL_REVISION,
    approximateBytes: 1_695_957_664,
  },
  {
    id: "qwen3-asr-0.6b",
    category: "asr",
    name: "Qwen3-ASR-0.6B",
    purpose: "中文与方言识别优先",
    repository: "Qwen/Qwen3-ASR-0.6B-hf",
    revision: QWEN3_ASR_MODEL_REVISION,
    approximateBytes: 1_576_000_000,
  },
  {
    id: "paraformer-zh",
    category: "asr",
    name: "Paraformer 中文套件",
    purpose: "轻量快速，包含语音检测与标点",
    repository: "funasr/paraformer-zh + fsmn-vad + ct-punc",
    revision: PARAFORMER_BUNDLE_REVISION,
    approximateBytes: 2_028_000_000,
    components: [
      {
        directory: "asr",
        repository: "funasr/paraformer-zh",
        revision: PARAFORMER_MODEL_REVISION,
      },
      {
        directory: "vad",
        repository: "funasr/fsmn-vad",
        revision: FSMN_VAD_MODEL_REVISION,
      },
      {
        directory: "punc",
        repository: "funasr/ct-punc",
        revision: CT_PUNC_MODEL_REVISION,
      },
    ],
  },
  {
    id: "qwen35-4b",
    category: "organizer",
    name: "Qwen3.5-4B",
    purpose: "总结、章节、问答与精彩片段",
    repository: "Qwen/Qwen3.5-4B",
    revision: QWEN_MODEL_REVISION,
    approximateBytes: 9_319_828_096,
  },
] as const;

export const PINNED_MODEL_REVISIONS: Readonly<Record<AiModelId, string>> = {
  vibevoice: VIBEVOICE_MODEL_REVISION,
  "qwen3-asr-0.6b": QWEN3_ASR_MODEL_REVISION,
  "paraformer-zh": PARAFORMER_BUNDLE_REVISION,
  "qwen35-4b": QWEN_MODEL_REVISION,
};

const METADATA_FILE = "state.json";
const MODEL_REQUEST_TIMEOUT_MS = 12_000;

// Hugging Face is frequently unreachable on otherwise healthy mainland networks.
// Keep the mirror first for a fast default path and retain the canonical host as
// an automatic fallback. Both endpoints expose the same immutable revision files.
export const MODEL_SOURCES: readonly ModelSource[] = [
  { name: "Hugging Face 镜像", baseUrl: "https://hf-mirror.com" },
  { name: "Hugging Face", baseUrl: "https://huggingface.co" },
] as const;

const modelDefinition = (id: AiModelId): ModelDefinition => {
  const definition = MODEL_DEFINITIONS.find((candidate) => candidate.id === id);
  if (!definition) throw new Error("unknown_ai_model");
  return definition;
};

const emptyState = (): PersistedAiState => ({ models: {}, taskCheckpoints: {} });

export const safeRelativeModelPath = (value: string): string => {
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.includes(":"),
    )
  ) {
    throw new Error("unsafe_ai_model_path");
  }
  return normalized;
};

export const buildResumeHeaders = (offset: number): Record<string, string> | undefined =>
  offset > 0 ? { Range: `bytes=${offset}-` } : undefined;

export const describeAiModelError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message === "fetch failed" ||
    message.includes("ai_model_source_unreachable") ||
    message.includes("ENETUNREACH") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT")
  ) {
    return "无法连接模型下载源。已尝试 Hugging Face 和国内镜像，请检查网络或代理后重试。";
  }
  if (message === "ai_model_disk_space_insufficient")
    return "磁盘剩余空间不足，请释放空间或调整模型存放位置后重试。";
  if (message === "ai_model_manifest_empty" || message === "ai_model_required_files_missing")
    return "模型文件清单不完整，请稍后重试。";
  if (message === "ai_model_file_incomplete" || message === "ai_model_weight_size_mismatch")
    return "模型文件下载不完整，点击重试会从已下载的位置继续。";
  const httpStatus = message.match(/ai_model_(?:manifest_)?http_(\d{3})/)?.[1];
  if (httpStatus) return `模型下载源暂时不可用（HTTP ${httpStatus}），请稍后重试。`;
  return "模型下载失败，请检查网络后重试；已下载的部分会保留。";
};

class DownloadPausedError extends Error {
  constructor() {
    super("ai_model_download_paused");
  }
}

export class AiModelManager {
  private readonly listeners = new Set<(snapshot: AiVoiceMemorySnapshot) => void>();
  private readonly qwenReleaseListeners = new Set<(reason: string) => void>();
  private readonly scheduler = new ResourceScheduler();
  private readonly abortControllers = new Map<AiModelId, AbortController>();
  private readonly runningDownloads = new Map<AiModelId, Promise<void>>();
  private readonly downloadStartedAt = new Map<AiModelId, number>();
  private persisted: PersistedAiState = emptyState();
  private processingMode: AiProcessingMode = "after_game";
  private gameActive = false;
  private runtimePressure: AiRuntimePressure = {
    inVoiceRoom: false,
    screenSharing: false,
    peerRecovering: false,
    latencyMs: 0,
    packetLossPercent: 0,
    rendererMemoryPressure: false,
    updatedAt: 0,
  };
  private realtimePressureHigh = false;
  private pressureReason?: string;
  private pressureReleaseTimer?: NodeJS.Timeout;
  private qwenLoaded = false;
  private queuedTasks = 0;
  private runningTask?: string;
  private persistQueue: Promise<void> = Promise.resolve();
  private throttleQueue: Promise<void> = Promise.resolve();
  private throttleWindowStartedAt = Date.now();
  private throttleWindowBytes = 0;
  private runtimeStatus: Partial<Record<AiModelId, { ready: boolean; message?: string }>> = {};
  private activeAsrModel: AiAsrModelId = "vibevoice";
  private runtimePreparer?: (id: AiModelId) => Promise<{ ready: boolean; message?: string }>;

  constructor(
    private readonly rootDirectory: string,
    private readonly gameDetection: GameDetectionController,
    private readonly writeLog: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  async initialize(
    processingMode: AiProcessingMode,
    activeAsrModel: AiAsrModelId = "vibevoice",
  ): Promise<void> {
    this.processingMode = processingMode;
    this.activeAsrModel = activeAsrModel;
    await mkdir(this.rootDirectory, { recursive: true });
    this.persisted = await this.readState();
    this.gameActive = Boolean(this.gameDetection.getSnapshot().gameName);
    this.scheduler.update({ processingMode, gameActive: this.gameActive });
    this.gameDetection.onDetected((snapshot) => {
      const nextGameActive = Boolean(snapshot.gameName);
      if (nextGameActive === this.gameActive) return;
      this.gameActive = nextGameActive;
      this.scheduler.update({ gameActive: this.gameActive });
      if (this.gameActive) this.releaseQwenResources("game_started");
      this.emit();
    });
    const interruptedDownloads: AiModelId[] = [];
    const missingOptInDownloads: AiModelId[] = [];
    for (const definition of MODEL_DEFINITIONS) {
      const model = this.persisted.models[definition.id];
      if (model?.phase === "downloading" || model?.phase === "checking") {
        model.phase = "paused";
        interruptedDownloads.push(definition.id);
      }
      if (
        model?.userInstalled &&
        !model.activeRevision &&
        model.phase !== "error" &&
        !interruptedDownloads.includes(definition.id)
      ) {
        missingOptInDownloads.push(definition.id);
      }
      if (
        model?.userInstalled &&
        model.activeRevision &&
        model.activeRevision !== definition.revision
      ) {
        void this.ensurePinnedRevision(definition.id);
      }
    }
    await this.persist();
    for (const id of interruptedDownloads) {
      this.startDownload(id, Boolean(this.persisted.models[id]?.activeRevision));
    }
    for (const id of missingOptInDownloads) this.startDownload(id, false);
  }

  stop(): void {
    for (const controller of this.abortControllers.values()) controller.abort();
    this.abortControllers.clear();
    if (this.pressureReleaseTimer) clearTimeout(this.pressureReleaseTimer);
    this.releaseQwenResources("app_stopping");
  }

  setProcessingMode(mode: AiProcessingMode): void {
    this.processingMode = mode;
    this.scheduler.update({ processingMode: mode });
    if (this.gameActive && mode === "after_game") this.releaseQwenResources("processing_deferred");
    this.emit();
  }

  setActiveAsrModel(id: AiAsrModelId): void {
    if (this.activeAsrModel === id) return;
    this.activeAsrModel = id;
    this.emit();
  }

  getActiveAsrModel(): AiAsrModelId {
    return this.activeAsrModel;
  }

  setRuntimePreparer(
    preparer: (id: AiModelId) => Promise<{ ready: boolean; message?: string }>,
  ): void {
    this.runtimePreparer = preparer;
  }

  updateRuntimePressure(pressure: AiRuntimePressure): void {
    this.runtimePressure = pressure;
    this.scheduler.update({ pressure });
    const reason = pressure.peerRecovering
      ? "peer_recovery"
      : pressure.screenSharing && (pressure.latencyMs > 180 || pressure.packetLossPercent > 3)
        ? "screen_share_network_pressure"
        : pressure.inVoiceRoom && (pressure.latencyMs > 260 || pressure.packetLossPercent > 5)
          ? "voice_network_pressure"
          : pressure.rendererMemoryPressure
            ? "memory_pressure"
            : undefined;
    if (reason) {
      if (this.pressureReleaseTimer) clearTimeout(this.pressureReleaseTimer);
      this.pressureReleaseTimer = undefined;
      this.realtimePressureHigh = true;
      this.pressureReason = reason;
      this.scheduler.update({ realtimePressureHigh: true, pressureReason: reason });
      this.releaseQwenResources(reason);
      this.emit();
      return;
    }
    if (!this.realtimePressureHigh || this.pressureReleaseTimer) return;
    this.pressureReleaseTimer = setTimeout(() => {
      this.pressureReleaseTimer = undefined;
      this.realtimePressureHigh = false;
      this.pressureReason = undefined;
      this.scheduler.update({ realtimePressureHigh: false, pressureReason: undefined });
      this.emit();
    }, 8_000);
  }

  shouldDeferBackgroundDownload(): boolean {
    return this.scheduler.backgroundDownloadDecision().defer;
  }

  onStatus(listener: (snapshot: AiVoiceMemorySnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onQwenReleaseRequested(listener: (reason: string) => void): () => void {
    this.qwenReleaseListeners.add(listener);
    return () => this.qwenReleaseListeners.delete(listener);
  }

  getSnapshot(): AiVoiceMemorySnapshot {
    return {
      models: MODEL_DEFINITIONS.map((definition) => this.buildModelStatus(definition)),
      scheduler: {
        processingMode: this.processingMode,
        gameActive: this.gameActive,
        downloadsThrottled:
          this.gameActive || this.realtimePressureHigh || this.runtimePressure.inVoiceRoom,
        aiTasksPausedForGame: this.gameActive && this.processingMode === "after_game",
        realtimePressureHigh: this.realtimePressureHigh,
        pressureReason: this.pressureReason,
        qwenLoaded: this.qwenLoaded,
        queuedTasks: this.queuedTasks,
        runningTask: this.runningTask,
      },
      checkedAt: new Date().toISOString(),
    };
  }

  setRuntimeStatus(id: AiModelId, ready: boolean, message?: string): void {
    this.runtimeStatus[id] = { ready, message };
    this.emit();
  }

  async controlModel(id: AiModelId, action: AiModelAction): Promise<AiVoiceMemorySnapshot> {
    const current = this.ensureModelState(id);
    if (action === "download") {
      current.userInstalled = true;
      await this.persist();
      this.startDownload(id, Boolean(current.activeRevision));
    } else if (action === "pause") {
      current.phase = "paused";
      this.abortControllers.get(id)?.abort();
      await this.persist();
      this.emit();
    } else if (action === "resume") {
      current.userInstalled = true;
      this.abortControllers.get(id)?.abort();
      await this.runningDownloads.get(id)?.catch(() => undefined);
      this.startDownload(id, Boolean(current.activeRevision));
    } else {
      this.abortControllers.get(id)?.abort();
      await this.runningDownloads.get(id)?.catch(() => undefined);
      await rm(this.modelDirectory(id), { recursive: true, force: true });
      this.persisted.models[id] = { userInstalled: false, phase: "not_installed" };
      delete this.runtimeStatus[id];
      if (id === "qwen35-4b") this.releaseQwenResources("model_deleted");
      await this.persist();
      this.emit();
    }
    return this.getSnapshot();
  }

  private async ensurePinnedRevision(id: AiModelId): Promise<void> {
    const current = this.ensureModelState(id);
    try {
      const definition = modelDefinition(id);
      if (current.activeRevision === definition.revision) return;
      current.pendingRevision = definition.revision;
      await this.persist();
      this.startDownload(id, true);
    } catch (error) {
      await this.log("warn", "ai_model_pinned_revision_check_failed", id, error);
    }
  }

  private startDownload(id: AiModelId, isUpdate: boolean): void {
    if (this.runningDownloads.has(id)) return;
    const operation = this.downloadModel(id, isUpdate)
      .catch((error) => {
        if (error instanceof DownloadPausedError || (error as Error).name === "AbortError") return;
        const current = this.ensureModelState(id);
        current.phase = "error";
        current.errorMessage = describeAiModelError(error);
        void this.persist();
        void this.log("error", "ai_model_download_failed", id, error);
      })
      .finally(() => {
        this.abortControllers.delete(id);
        this.runningDownloads.delete(id);
        this.downloadStartedAt.delete(id);
        this.emit();
      });
    this.runningDownloads.set(id, operation);
    this.downloadStartedAt.set(id, Date.now());
    this.emit();
  }

  private async downloadModel(id: AiModelId, isUpdate: boolean): Promise<void> {
    const definition = modelDefinition(id);
    const current = this.ensureModelState(id);
    const controller = new AbortController();
    this.abortControllers.set(id, controller);
    current.phase = "checking";
    current.errorMessage = undefined;
    this.emit();

    const files = await this.fetchDownloadFiles(definition);
    if (!files.length) throw new Error("ai_model_manifest_empty");
    current.pendingRevision = definition.revision;
    current.totalBytes = files.reduce((total, file) => total + (file.size ?? 0), 0);
    current.downloadedBytes = await this.readDownloadedBytes(id, definition.revision, files);
    await this.ensureDiskCapacity((current.totalBytes ?? 0) - (current.downloadedBytes ?? 0));
    current.phase = "downloading";
    await this.persist();

    for (const file of files) {
      if (controller.signal.aborted) throw new DownloadPausedError();
      await this.downloadFile(definition.id, definition.revision, file, controller.signal, current);
    }

    const revisionDirectory = this.revisionDirectory(id, definition.revision);
    await this.validateRevision(definition, definition.revision, files);
    await writeFile(
      path.join(revisionDirectory, "model.ready.json"),
      JSON.stringify(
        {
          repository: definition.repository,
          revision: definition.revision,
          components: this.modelComponents(definition),
          files,
        },
        null,
        2,
      ),
      "utf8",
    );
    const previousRevision = current.activeRevision;
    current.activeRevision = definition.revision;
    current.pendingRevision = undefined;
    current.phase = "installed";
    current.downloadedBytes = current.totalBytes;
    current.errorMessage = undefined;
    await this.persist();
    this.emit();

    await this.prepareRuntime(id);

    if (isUpdate && previousRevision && previousRevision !== definition.revision) {
      await rm(this.revisionDirectory(id, previousRevision), { recursive: true, force: true });
    }
    await this.log("info", "ai_model_ready", id, undefined, { revision: definition.revision });
  }

  private async prepareRuntime(id: AiModelId): Promise<void> {
    if (!this.runtimePreparer) return;
    try {
      const result = await this.runtimePreparer(id);
      this.runtimeStatus[id] = result;
      await this.log("info", "ai_model_runtime_checked", id, undefined, {
        ready: result.ready,
        message: result.message,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.runtimeStatus[id] = { ready: false, message };
      await this.log("error", "ai_model_runtime_prepare_failed", id, error);
    }
    this.emit();
  }

  private async downloadFile(
    id: AiModelId,
    revision: string,
    file: DownloadModelFile,
    signal: AbortSignal,
    state: PersistedModelState,
  ): Promise<void> {
    const destination = path.join(this.revisionDirectory(id, revision), file.rfilename);
    const partial = `${destination}.part`;
    await mkdir(path.dirname(destination), { recursive: true });
    const expectedSize = file.size ?? 0;
    const completedSize = await stat(destination)
      .then((value) => value.size)
      .catch(() => 0);
    if (expectedSize > 0 && completedSize === expectedSize) return;

    let offset = await stat(partial)
      .then((value) => value.size)
      .catch(() => 0);
    if (offset > expectedSize) {
      await unlink(partial).catch(() => undefined);
      offset = 0;
    }
    const relativeUrl = `${file.sourceRepository}/resolve/${file.sourceRevision}/${file.sourceFileName
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
    const { response, release } = await this.fetchFromModelSources(relativeUrl, {
      headers: buildResumeHeaders(offset),
      signal,
      acceptedStatuses: [200, 206],
      errorPrefix: "ai_model_http",
    });
    try {
      if (offset && response.status === 200) {
        await unlink(partial).catch(() => undefined);
        state.downloadedBytes = Math.max(0, (state.downloadedBytes ?? 0) - offset);
        offset = 0;
      }
      if (!response.body) throw new Error("ai_model_empty_response");

      const throttle = this.createThrottle();
      let received = offset;
      let lastPersistedAt = Date.now();
      const progress = new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          received += chunk.length;
          state.downloadedBytes = Math.min(
            state.totalBytes ?? Number.MAX_SAFE_INTEGER,
            (state.downloadedBytes ?? 0) + chunk.length,
          );
          const now = Date.now();
          if (now - lastPersistedAt >= 1_000) {
            lastPersistedAt = now;
            void this.persist();
            this.emit();
          }
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body as never),
        throttle,
        progress,
        createWriteStream(partial, { flags: offset ? "a" : "w" }),
        { signal },
      );
      if (expectedSize && received !== expectedSize) throw new Error("ai_model_file_incomplete");
      await rename(partial, destination);
    } finally {
      release();
    }
  }

  private createThrottle(): Transform {
    return new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        const operation = this.throttleQueue
          .catch(() => undefined)
          .then(async () => {
            const now = Date.now();
            if (now - this.throttleWindowStartedAt >= 1_000) {
              this.throttleWindowStartedAt = now;
              this.throttleWindowBytes = 0;
            }
            this.throttleWindowBytes += chunk.length;
            const limit = this.scheduler.downloadBytesPerSecond();
            const delay = Math.max(
              0,
              Math.ceil(
                (this.throttleWindowBytes / limit) * 1_000 - (now - this.throttleWindowStartedAt),
              ),
            );
            if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
          });
        this.throttleQueue = operation;
        void operation.then(() => callback(null, chunk), callback);
      },
    });
  }

  private async validateRevision(
    definition: ModelDefinition,
    revision: string,
    files: RemoteModelFile[],
  ): Promise<void> {
    const directory = this.revisionDirectory(definition.id, revision);
    const weightFiles = files.filter(
      (file) =>
        file.rfilename.endsWith(".safetensors") ||
        file.rfilename.endsWith(".gguf") ||
        file.rfilename.endsWith("model.pt"),
    );
    if (!weightFiles.length) throw new Error("ai_model_required_files_missing");
    if (definition.id === "vibevoice") {
      const names = new Set(weightFiles.map((file) => path.basename(file.rfilename)));
      if (
        !names.has("vibeasr-lm-i2_s-embed-q6_k.gguf") ||
        !names.has("vibeasr-vae-encoder-i8_s.gguf")
      ) {
        throw new Error("ai_model_required_files_missing");
      }
    } else if (definition.id === "paraformer-zh") {
      for (const component of ["asr", "vad", "punc"] as const) {
        await Promise.all([
          stat(path.join(directory, component, "config.yaml")),
          stat(path.join(directory, component, "model.pt")),
        ]).catch(() => {
          throw new Error("ai_model_required_files_missing");
        });
      }
    } else {
      const config = JSON.parse(
        await readFile(path.join(directory, "config.json"), "utf8"),
      ) as unknown;
      if (!config || typeof config !== "object") throw new Error("ai_model_config_invalid");
    }
    for (const file of weightFiles) {
      const size = await stat(path.join(directory, file.rfilename)).then((value) => value.size);
      if (file.size && size !== file.size) throw new Error("ai_model_weight_size_mismatch");
    }
  }

  private isVibeVoiceRuntimeFile(fileName: string): boolean {
    return (
      fileName === "vibeasr-lm-i2_s-embed-q6_k.gguf" || fileName === "vibeasr-vae-encoder-i8_s.gguf"
    );
  }

  private modelComponents(definition: ModelDefinition): readonly ModelComponent[] {
    return (
      definition.components ?? [
        {
          directory: "",
          repository: definition.repository,
          revision: definition.revision,
        },
      ]
    );
  }

  private async fetchDownloadFiles(definition: ModelDefinition): Promise<DownloadModelFile[]> {
    const components = this.modelComponents(definition);
    const manifests = await Promise.all(
      components.map(async (component) => ({
        component,
        manifest: await this.fetchManifest(component),
      })),
    );
    return manifests.flatMap(({ component, manifest }) =>
      manifest.siblings
        .filter(
          (file) =>
            typeof file.size === "number" &&
            file.size > 0 &&
            (definition.id !== "vibevoice" || this.isVibeVoiceRuntimeFile(file.rfilename)),
        )
        .map((file): DownloadModelFile => {
          const sourceFileName = safeRelativeModelPath(file.rfilename);
          const destination = component.directory
            ? safeRelativeModelPath(`${component.directory}/${sourceFileName}`)
            : sourceFileName;
          return {
            ...file,
            rfilename: destination,
            sourceFileName,
            sourceRepository: component.repository,
            sourceRevision: component.revision,
          };
        }),
    );
  }

  private async fetchManifest(component: ModelComponent): Promise<RemoteModelManifest> {
    const { response, release } = await this.fetchFromModelSources(
      `api/models/${component.repository}/revision/${component.revision}?blobs=true`,
      {
        acceptedStatuses: [200],
        errorPrefix: "ai_model_manifest_http",
      },
    );
    try {
      const manifest = (await response.json()) as RemoteModelManifest;
      if (!manifest.sha || !Array.isArray(manifest.siblings))
        throw new Error("ai_model_manifest_invalid");
      if (manifest.sha !== component.revision) throw new Error("ai_model_revision_mismatch");
      return manifest;
    } finally {
      release();
    }
  }

  private async fetchFromModelSources(
    relativeUrl: string,
    options: {
      headers?: Record<string, string>;
      signal?: AbortSignal;
      acceptedStatuses: number[];
      errorPrefix: string;
    },
  ): Promise<{ response: Response; release: () => void }> {
    let lastError: unknown;
    for (const source of MODEL_SOURCES) {
      if (options.signal?.aborted) throw new DownloadPausedError();
      const controller = new AbortController();
      const forwardAbort = () => controller.abort();
      options.signal?.addEventListener("abort", forwardAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(), MODEL_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(`${source.baseUrl}/${relativeUrl}`, {
          headers: options.headers,
          redirect: "follow",
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!options.acceptedStatuses.includes(response.status)) {
          lastError = new Error(`${options.errorPrefix}_${response.status}`);
          await response.body?.cancel().catch(() => undefined);
          options.signal?.removeEventListener("abort", forwardAbort);
          continue;
        }
        return {
          response,
          release: () => options.signal?.removeEventListener("abort", forwardAbort),
        };
      } catch (error) {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", forwardAbort);
        if (options.signal?.aborted) throw new DownloadPausedError();
        lastError = error;
      }
    }
    if (lastError instanceof Error && lastError.message.startsWith(options.errorPrefix))
      throw lastError;
    throw new Error("ai_model_source_unreachable", { cause: lastError });
  }

  private async readDownloadedBytes(
    id: AiModelId,
    revision: string,
    files: RemoteModelFile[],
  ): Promise<number> {
    let total = 0;
    for (const file of files) {
      const destination = path.join(this.revisionDirectory(id, revision), file.rfilename);
      const expected = file.size ?? 0;
      const complete = await stat(destination)
        .then((value) => value.size)
        .catch(() => 0);
      const partial = await stat(`${destination}.part`)
        .then((value) => value.size)
        .catch(() => 0);
      total += Math.min(expected, complete === expected ? complete : partial);
    }
    return total;
  }

  private buildModelStatus(definition: ModelDefinition): AiModelStatus {
    const current = this.persisted.models[definition.id];
    const totalBytes = current?.totalBytes ?? 0;
    const downloadedBytes = current?.downloadedBytes ?? 0;
    return {
      ...definition,
      phase: current?.phase ?? (current?.activeRevision ? "installed" : "not_installed"),
      userInstalled: current?.userInstalled === true,
      activeRevision: current?.activeRevision,
      pendingRevision: current?.pendingRevision,
      downloadedBytes,
      totalBytes,
      progress: totalBytes ? Math.min(100, (downloadedBytes / totalBytes) * 100) : 0,
      bytesPerSecond: this.downloadStartedAt.has(definition.id)
        ? this.scheduler.downloadBytesPerSecond()
        : undefined,
      errorMessage: current?.errorMessage,
      runtimeReady: this.runtimeStatus[definition.id]?.ready === true,
      runtimeMessage: this.runtimeStatus[definition.id]?.message,
      updateInProgress: Boolean(
        current?.activeRevision &&
        current.pendingRevision &&
        current.activeRevision !== current.pendingRevision,
      ),
    };
  }

  private ensureModelState(id: AiModelId): PersistedModelState {
    return (this.persisted.models[id] ??= { userInstalled: false, phase: "not_installed" });
  }

  private modelDirectory(id: AiModelId): string {
    return path.join(this.rootDirectory, id);
  }

  getActiveModelDirectory(id: AiModelId): string | undefined {
    const revision = this.persisted.models[id]?.activeRevision;
    return revision ? this.revisionDirectory(id, revision) : undefined;
  }

  private revisionDirectory(id: AiModelId, revision: string): string {
    return path.join(this.modelDirectory(id), revision);
  }

  private async readState(): Promise<PersistedAiState> {
    try {
      const parsed = JSON.parse(
        await readFile(path.join(this.rootDirectory, METADATA_FILE), "utf8"),
      ) as Partial<PersistedAiState>;
      return {
        models: parsed.models && typeof parsed.models === "object" ? parsed.models : {},
        taskCheckpoints:
          parsed.taskCheckpoints && typeof parsed.taskCheckpoints === "object"
            ? parsed.taskCheckpoints
            : {},
      };
    } catch {
      return emptyState();
    }
  }

  private async ensureDiskCapacity(remainingBytes: number): Promise<void> {
    if (remainingBytes <= 0) return;
    const disk = await statfs(this.rootDirectory);
    const availableBytes = Number(disk.bavail) * Number(disk.bsize);
    const safetyMargin = 512 * 1024 * 1024;
    if (availableBytes < remainingBytes + safetyMargin) {
      throw new Error("ai_model_disk_space_insufficient");
    }
  }

  private persist(): Promise<void> {
    const serialized = JSON.stringify(this.persisted, null, 2);
    const operation = this.persistQueue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.rootDirectory, { recursive: true });
        const file = path.join(this.rootDirectory, METADATA_FILE);
        const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, serialized, "utf8");
        await rename(temporary, file);
      });
    this.persistQueue = operation;
    return operation;
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private releaseQwenResources(reason: string): void {
    for (const listener of this.qwenReleaseListeners) listener(reason);
    if (!this.qwenLoaded && this.queuedTasks === 0) return;
    this.qwenLoaded = false;
    this.queuedTasks = 0;
    void this.log("info", "ai_qwen_resources_released", "qwen35-4b", undefined, { reason });
    this.emit();
  }

  setQwenRuntimeState(loaded: boolean, queuedTasks: number): void {
    if (this.qwenLoaded === loaded && this.queuedTasks === queuedTasks) return;
    this.qwenLoaded = loaded;
    this.queuedTasks = Math.max(0, queuedTasks);
    this.emit();
  }

  markQwenTaskStarted(taskName: string): void {
    this.runningTask = taskName;
    this.emit();
  }

  markAiTaskFinished(): void {
    this.runningTask = undefined;
    this.emit();
  }

  canRunTask(
    kind: AiTaskKind,
    manualRequest = false,
  ): {
    runnable: boolean;
    reason?: string;
    resourceMode: "low" | "normal";
    requiredModel: AiModelId;
  } {
    const requiredModel = kind === "transcription" ? this.activeAsrModel : "qwen35-4b";
    if (!this.persisted.models[requiredModel]?.activeRevision) {
      return {
        runnable: false,
        reason: `model_${requiredModel}_not_installed`,
        resourceMode: "low",
        requiredModel,
      };
    }
    const runtime = this.runtimeStatus[requiredModel];
    if (!runtime?.ready) {
      return {
        runnable: false,
        reason: runtime?.message || `model_${requiredModel}_runtime_not_ready`,
        resourceMode: "low",
        requiredModel,
      };
    }
    return { ...this.scheduler.aiDecision(kind, manualRequest), requiredModel };
  }

  async saveTaskCheckpoint(checkpoint: AiTaskCheckpoint): Promise<void> {
    if (!checkpoint.taskId || !checkpoint.recordingId || checkpoint.totalUnits < 1) {
      throw new Error("invalid_ai_task_checkpoint");
    }
    this.persisted.taskCheckpoints[checkpoint.taskId] = {
      ...checkpoint,
      completedUnits: Math.max(0, Math.min(checkpoint.totalUnits, checkpoint.completedUnits)),
      updatedAt: new Date().toISOString(),
    };
    await this.persist();
  }

  getTaskCheckpoint(taskId: string): AiTaskCheckpoint | undefined {
    const checkpoint = this.persisted.taskCheckpoints[taskId];
    return checkpoint ? { ...checkpoint } : undefined;
  }

  async clearTaskCheckpoint(taskId: string): Promise<void> {
    if (!(taskId in this.persisted.taskCheckpoints)) return;
    delete this.persisted.taskCheckpoints[taskId];
    await this.persist();
  }

  private async log(
    level: RendererLogPayload["level"],
    message: string,
    modelId: AiModelId,
    error?: unknown,
    context?: Record<string, unknown>,
  ): Promise<void> {
    await this.writeLog({
      category: "recording",
      level,
      message,
      context: {
        modelId,
        gameActive: this.gameActive,
        ...context,
        error: error instanceof Error ? error.message : error ? String(error) : undefined,
      },
    });
  }
}
