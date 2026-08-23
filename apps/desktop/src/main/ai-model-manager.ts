import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import type {
  AiAsrModelId,
  AiModelAction,
  AiModelFailureKind,
  AiModelId,
  AiModelStatus,
  AiProcessingMode,
  AiRuntimePressure,
  AiSupportModelId,
  AiTaskCheckpoint,
  AiTaskKind,
  AiVoiceMemorySnapshot,
  RendererLogPayload,
} from "@private-voice/shared";

import type { GameDetectionController } from "./game-detection";
import { requiredModelFiles, requiredWeightFiles } from "./ai-model-layout";
import { ResourceScheduler } from "./resource-scheduler";

export {
  GAMING_DOWNLOAD_BYTES_PER_SECOND,
  NORMAL_DOWNLOAD_BYTES_PER_SECOND,
  REALTIME_PRESSURE_DOWNLOAD_BYTES_PER_SECOND,
} from "./resource-scheduler";

interface ModelDefinition {
  id: AiModelId;
  category: "asr" | "support" | "organizer";
  name: string;
  purpose: string;
  repository: string;
  revision: string;
  approximateBytes: number;
  components?: readonly ModelComponent[];
  dependencies?: readonly AiSupportModelId[];
  optionalDependencies?: readonly AiSupportModelId[];
  requiresHuggingFaceAuthorization?: boolean;
  hardwareNote?: string;
}

interface ModelComponent {
  directory: string;
  repository: string;
  revision: string;
}

export interface RemoteModelFile {
  rfilename: string;
  size?: number;
  sha256?: string;
  lfs?: { sha256?: string; size?: number };
}

interface RemoteModelManifest {
  sha: string;
  siblings: RemoteModelFile[];
}

interface DownloadModelFile extends RemoteModelFile {
  sourceFileName: string;
  sourceRepository: string;
  sourceRevision: string;
  sha256?: string;
}

interface ModelSource {
  name: string;
  baseUrl: string;
}

type ModelFetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface PersistedModelState {
  userInstalled: boolean;
  activeRevision?: string;
  pendingRevision?: string;
  phase?: AiModelStatus["phase"];
  downloadedBytes?: number;
  totalBytes?: number;
  errorMessage?: string;
  failureKind?: AiModelFailureKind;
}

interface PersistedAiState {
  models: Partial<Record<AiModelId, PersistedModelState>>;
  taskCheckpoints: Record<string, AiTaskCheckpoint>;
}

const QWEN3_ASR_17B_MODEL_REVISION = "7278e1e70fe206f11671096ffdd38061171dd6e5";
const QWEN3_ASR_06B_MODEL_REVISION = "5eb144179a02acc5e5ba31e748d22b0cf3e303b0";
const QWEN3_FORCED_ALIGNER_REVISION = "c7cbfc2048c462b0d63a45797104fc9db3ad62b7";
const FUN_ASR_NANO_REVISION = "272c57b82523ada6fd87095e955f8e29100979ab";
const GLM_ASR_NANO_REVISION = "61ba4e0b3309b6656edea3e93e419f7bd5c61957";
const FIRERED_ASR2_AED_REVISION = "2304afed56eacfee6256dee5937ed22ffa0b64ec";
const PARAFORMER_MODEL_REVISION = "d7811ee3ac581fbcfdeb37c98c6ba674028433dc";
const FSMN_VAD_MODEL_REVISION = "df20e6b30c653645fa4ff125cacfcabd1020a669";
const CT_PUNC_MODEL_REVISION = "d0e55e2b8722a78b63705ff443d09c4f86e5d750";
const PARAFORMER_BUNDLE_REVISION = "bundle-d7811ee3-df20e6b3-d0e55e2b";
const MOSS_TRANSCRIBE_DIARIZE_REVISION = "e8681d68e7042738ffca8ac8212bc8fcb1131ab8";
const DOLPHIN_CN_DIALECT_REVISION = "eb6854969b5715cfccf4a9297a75f189343700dc";
const COHERE_TRANSCRIBE_REVISION = "00c06981f239c788c0ce23b8caa001c071e4e391";
const QWEN_MODEL_REVISION = "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a";

const MODEL_DEFINITIONS: readonly ModelDefinition[] = [
  {
    id: "qwen3-asr-1.7b-force",
    category: "asr",
    name: "Qwen3-ASR-1.7B + ForcedAligner",
    purpose: "高质量 · 精确时间轴",
    repository: "Qwen/Qwen3-ASR-1.7B",
    revision: QWEN3_ASR_17B_MODEL_REVISION,
    approximateBytes: 4_703_114_308,
    dependencies: ["qwen3-forced-aligner-0.6b"],
    hardwareNote: "CUDA · BF16 · batch 1 · 不量化；显存不足时明确提示，不会静默降级。",
  },
  {
    id: "qwen3-asr-0.6b-force",
    category: "asr",
    name: "Qwen3-ASR-0.6B + ForcedAligner",
    purpose: "轻量 · 精确时间轴",
    repository: "Qwen/Qwen3-ASR-0.6B",
    revision: QWEN3_ASR_06B_MODEL_REVISION,
    approximateBytes: 1_880_619_678,
    dependencies: ["qwen3-forced-aligner-0.6b"],
    hardwareNote: "CUDA · BF16 · batch 1 · 不量化。",
  },
  {
    id: "fun-asr-nano-2512",
    category: "asr",
    name: "Fun-ASR-Nano-2512",
    purpose: "新一代中文 LLM ASR",
    repository: "FunAudioLLM/Fun-ASR-Nano-2512",
    revision: FUN_ASR_NANO_REVISION,
    approximateBytes: 1_989_178_168,
    hardwareNote: "CUDA · BF16 · batch 1 · 官方本地推理 · 不量化。",
  },
  {
    id: "glm-asr-nano-2512",
    category: "asr",
    name: "GLM-ASR-Nano-2512",
    purpose: "噪声 · 轻声 · 复杂环境",
    repository: "zai-org/GLM-ASR-Nano-2512",
    revision: GLM_ASR_NANO_REVISION,
    approximateBytes: 4_522_623_926,
    hardwareNote: "CUDA · BF16 · batch 1 · 固定确定性输出 · 长录音分段 · 不量化。",
  },
  {
    id: "fireredasr2-aed",
    category: "asr",
    name: "FireRedASR2-AED",
    purpose: "高质量中文 ASR · 原生时间戳",
    repository: "FireRedTeam/FireRedASR2-AED",
    revision: FIRERED_ASR2_AED_REVISION,
    approximateBytes: 4_731_895_352,
    hardwareNote: "CUDA · FP16 · batch 1 · 官方原生时间戳 · 不量化。",
  },
  {
    id: "paraformer-zh",
    category: "asr",
    name: "Paraformer 中文套件",
    purpose: "极速转录 · 时间轴稳定",
    repository: "funasr/paraformer-zh + fsmn-vad + ct-punc",
    revision: PARAFORMER_BUNDLE_REVISION,
    approximateBytes: 2_027_343_620,
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
    id: "moss-transcribe-diarize-0.9b",
    category: "asr",
    name: "MOSS-Transcribe-Diarize 0.9B",
    purpose: "长音频 · 原生说话人分离 · 时间戳",
    repository: "OpenMOSS-Team/MOSS-Transcribe-Diarize",
    revision: MOSS_TRANSCRIBE_DIARIZE_REVISION,
    approximateBytes: 1_965_000_000,
    hardwareNote: "CUDA · BF16 · batch 1 · 官方远程代码与原生 S01/S02 说话人标签 · 不量化。",
  },
  {
    id: "dolphin-cn-dialect-0.4b",
    category: "asr",
    name: "Dolphin-CN-Dialect 0.4B",
    purpose: "中文方言 · small.cn 非流式 · 词级时间戳",
    repository: "DataoceanAI1/dolphi-cn-dialect-small",
    revision: DOLPHIN_CN_DIALECT_REVISION,
    approximateBytes: 1_776_000_000,
    hardwareNote: "CUDA · batch 1 · 官方 small.cn 非流式权重 · 保留热词入口 · 不量化。",
  },
  {
    id: "cohere-transcribe-2b",
    category: "asr",
    name: "Cohere Transcribe 2B",
    purpose: "多语言 · 官方本地推理 · 可选精确对齐",
    repository: "CohereLabs/cohere-transcribe-03-2026",
    revision: COHERE_TRANSCRIBE_REVISION,
    approximateBytes: 4_435_000_000,
    optionalDependencies: ["qwen3-forced-aligner-0.6b"],
    requiresHuggingFaceAuthorization: true,
    hardwareNote:
      "CUDA · BF16 · batch 1 · 不量化；官方仓库需先接受 Hugging Face 使用条款，未安装对齐组件时使用真实分段边界。",
  },
  {
    id: "qwen3-forced-aligner-0.6b",
    category: "support",
    name: "Qwen3-ForcedAligner-0.6B",
    purpose: "两套 Qwen 共用的官方时间对齐组件",
    repository: "Qwen/Qwen3-ForcedAligner-0.6B",
    revision: QWEN3_FORCED_ALIGNER_REVISION,
    approximateBytes: 1_840_072_459,
  },
  {
    id: "qwen35-4b",
    category: "organizer",
    name: "Qwen3.5-4B",
    purpose: "总结、章节与精彩片段",
    repository: "Qwen/Qwen3.5-4B",
    revision: QWEN_MODEL_REVISION,
    approximateBytes: 9_319_828_096,
  },
] as const;

export const PINNED_MODEL_REVISIONS: Readonly<Record<AiModelId, string>> = {
  "qwen3-asr-1.7b-force": QWEN3_ASR_17B_MODEL_REVISION,
  "qwen3-asr-0.6b-force": QWEN3_ASR_06B_MODEL_REVISION,
  "fun-asr-nano-2512": FUN_ASR_NANO_REVISION,
  "glm-asr-nano-2512": GLM_ASR_NANO_REVISION,
  "fireredasr2-aed": FIRERED_ASR2_AED_REVISION,
  "paraformer-zh": PARAFORMER_BUNDLE_REVISION,
  "moss-transcribe-diarize-0.9b": MOSS_TRANSCRIBE_DIARIZE_REVISION,
  "dolphin-cn-dialect-0.4b": DOLPHIN_CN_DIALECT_REVISION,
  "cohere-transcribe-2b": COHERE_TRANSCRIBE_REVISION,
  "qwen3-forced-aligner-0.6b": QWEN3_FORCED_ALIGNER_REVISION,
  "qwen35-4b": QWEN_MODEL_REVISION,
};

const METADATA_FILE = "state.json";
const MODEL_REQUEST_TIMEOUT_MS = 12_000;
const MAX_CONCURRENT_MODEL_DOWNLOADS = 2;
const MODEL_FILE_DOWNLOAD_ATTEMPTS = 3;

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
  if (message.includes("ai_model_access_token_required"))
    return "此模型需要 Hugging Face 授权。请先接受模型使用条款，再把只读 Token 保存到本机。";
  if (/ai_model_(?:manifest_)?http_401/.test(message))
    return "Hugging Face Token 无效或已失效，请重新保存只读 Token。";
  if (/ai_model_(?:manifest_)?http_403/.test(message))
    return "当前 Hugging Face 账号尚未获得此模型权限，请先接受模型使用条款。";
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
  if (message === "ai_model_file_size_mismatch")
    return "模型完整性校验失败，大小异常的文件会在重试时重新下载。";
  if (message === "ai_model_checksum_mismatch")
    return "模型完整性校验失败，损坏文件会在重试时重新下载。";
  const httpStatus = message.match(/ai_model_(?:manifest_)?http_(\d{3})/)?.[1];
  if (httpStatus) return `模型下载源暂时不可用（HTTP ${httpStatus}），请稍后重试。`;
  return "模型下载失败，请检查网络后重试；已下载的部分会保留。";
};

export const classifyAiModelFailure = (error: unknown): AiModelFailureKind => {
  const message = error instanceof Error ? error.message : String(error);
  if (
    [
      "ai_model_required_files_missing",
      "ai_model_file_incomplete",
      "ai_model_weight_size_mismatch",
      "ai_model_file_size_mismatch",
      "ai_model_checksum_mismatch",
      "ai_model_config_invalid",
    ].some((code) => message.includes(code))
  )
    return "integrity";
  if (message.includes("ai_model_disk_space_insufficient") || message.includes("ENOSPC"))
    return "disk";
  if (
    message.includes("ai_model_access_token_required") ||
    /ai_model_(?:manifest_)?http_(401|403)/.test(message)
  )
    return "access";
  if (
    message === "fetch failed" ||
    message.includes("ai_model_source_unreachable") ||
    message.includes("ENETUNREACH") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT") ||
    /ai_model_(?:manifest_)?http_\d{3}/.test(message)
  )
    return "network";
  return "download";
};

const hashModelFile = async (filePath: string): Promise<string> => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
};

const replaceStateFile = async (temporary: string, destination: string): Promise<void> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temporary, destination);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)));
    }
  }
  throw lastError;
};

export const validateModelRevisionFiles = async (
  id: AiModelId,
  directory: string,
  files: readonly RemoteModelFile[],
): Promise<void> => {
  const manifestNames = files.map((file) => file.rfilename);
  const requiredFiles = requiredModelFiles(id);
  const weightNames = requiredWeightFiles(id, manifestNames);
  if (
    !weightNames.length ||
    requiredFiles.some((required) => !manifestNames.includes(required)) ||
    weightNames.some((required) => !manifestNames.includes(required))
  ) {
    throw new Error("ai_model_required_files_missing");
  }
  await Promise.all(requiredFiles.map((file) => stat(path.join(directory, file)))).catch(() => {
    throw new Error("ai_model_required_files_missing");
  });
  for (const configName of requiredFiles.filter((file) => file.endsWith(".json"))) {
    try {
      const config = JSON.parse(
        await readFile(path.join(directory, configName), "utf8"),
      ) as unknown;
      if (!config || typeof config !== "object") throw new Error("ai_model_config_invalid");
    } catch (error) {
      if (error instanceof Error && error.message === "ai_model_config_invalid") throw error;
      throw new Error("ai_model_config_invalid", { cause: error });
    }
  }
  for (const file of files) {
    const filePath = path.join(directory, file.rfilename);
    const size = await stat(filePath)
      .then((value) => value.size)
      .catch((error) => {
        throw new Error("ai_model_required_files_missing", { cause: error });
      });
    if (typeof file.size === "number" && size !== file.size) {
      await rm(filePath, { force: true });
      throw new Error("ai_model_file_size_mismatch");
    }
    if (typeof file.sha256 === "string") {
      const digest = await hashModelFile(filePath);
      if (digest !== file.sha256) {
        await rm(filePath, { force: true });
        throw new Error("ai_model_checksum_mismatch");
      }
    }
  }
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
  private readonly downloadSpeedSamples = new Map<
    AiModelId,
    { bytes: number; checkedAt: number }
  >();
  private readonly downloadSpeeds = new Map<AiModelId, number>();
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
  private activeModelDownloads = 0;
  private readonly downloadSlotWaiters: Array<{
    signal: AbortSignal;
    onAbort: () => void;
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
  }> = [];
  private runtimeStatus: Partial<Record<AiModelId, { ready: boolean; message?: string }>> = {};
  private activeAsrModel: AiAsrModelId = "qwen3-asr-0.6b-force";
  private runtimePreparer?: (id: AiModelId) => Promise<{ ready: boolean; message?: string }>;

  constructor(
    private readonly rootDirectory: string,
    private readonly gameDetection: GameDetectionController,
    private readonly writeLog: (payload: RendererLogPayload) => Promise<void>,
    private readonly modelFetch: ModelFetcher = globalThis.fetch,
    private readonly readHuggingFaceAccessToken?: () => Promise<string | undefined>,
  ) {}

  async initialize(
    processingMode: AiProcessingMode,
    activeAsrModel: AiAsrModelId = "qwen3-asr-0.6b-force",
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
      if (
        model?.phase === "queued" ||
        model?.phase === "checking" ||
        model?.phase === "downloading" ||
        model?.phase === "verifying" ||
        model?.phase === "preparing"
      ) {
        model.phase = "paused";
        interruptedDownloads.push(definition.id);
      }
      if (
        model?.userInstalled &&
        !model.activeRevision &&
        (model.phase !== "error" ||
          model.failureKind !== "integrity" ||
          (Boolean(model.totalBytes) && model.downloadedBytes === model.totalBytes)) &&
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
    const downloads = [...new Set([...interruptedDownloads, ...missingOptInDownloads])].sort(
      (left, right) => this.downloadPriority(left) - this.downloadPriority(right),
    );
    for (const id of downloads) {
      this.startDownload(id, Boolean(this.persisted.models[id]?.activeRevision));
    }
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

  setRuntimeStatuses(
    statuses: Partial<Record<AiModelId, { ready: boolean; message?: string }>>,
  ): void {
    Object.assign(this.runtimeStatus, statuses);
    this.emit();
  }

  async controlModel(id: AiModelId, action: AiModelAction): Promise<AiVoiceMemorySnapshot> {
    const current = this.ensureModelState(id);
    if (action === "download") {
      current.userInstalled = true;
      await this.persist();
      this.startDownload(id, Boolean(current.activeRevision));
      for (const dependency of modelDefinition(id).dependencies ?? []) {
        const dependencyState = this.ensureModelState(dependency);
        dependencyState.userInstalled = true;
        this.startDownload(dependency, Boolean(dependencyState.activeRevision));
      }
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
    const controller = new AbortController();
    this.abortControllers.set(id, controller);
    const current = this.ensureModelState(id);
    current.phase = "queued";
    current.errorMessage = undefined;
    current.failureKind = undefined;
    void this.persist();
    const operation = this.withDownloadSlot(controller.signal, () =>
      this.downloadModel(id, isUpdate, controller),
    )
      .catch((error) => {
        if (error instanceof DownloadPausedError || (error as Error).name === "AbortError") return;
        const current = this.ensureModelState(id);
        current.phase = "error";
        current.failureKind = classifyAiModelFailure(error);
        current.errorMessage = describeAiModelError(error);
        void this.persist();
        void this.log(
          "error",
          current.failureKind === "integrity"
            ? "ai_model_integrity_validation_failed"
            : "ai_model_download_failed",
          id,
          error,
          { failureKind: current.failureKind },
        );
      })
      .finally(() => {
        this.abortControllers.delete(id);
        this.runningDownloads.delete(id);
        this.downloadStartedAt.delete(id);
        this.downloadSpeedSamples.delete(id);
        this.downloadSpeeds.delete(id);
        this.emit();
      });
    this.runningDownloads.set(id, operation);
    this.downloadStartedAt.set(id, Date.now());
    this.emit();
  }

  private async downloadModel(
    id: AiModelId,
    isUpdate: boolean,
    controller: AbortController,
  ): Promise<void> {
    const definition = modelDefinition(id);
    const current = this.ensureModelState(id);
    current.phase = "checking";
    current.errorMessage = undefined;
    current.failureKind = undefined;
    this.emit();

    const files = await this.fetchDownloadFiles(definition);
    if (!files.length) throw new Error("ai_model_manifest_empty");
    current.pendingRevision = definition.revision;
    current.totalBytes = files.reduce((total, file) => total + (file.size ?? 0), 0);
    current.downloadedBytes = await this.readDownloadedBytes(id, definition.revision, files);
    this.downloadSpeedSamples.set(id, {
      bytes: current.downloadedBytes,
      checkedAt: Date.now(),
    });
    await this.ensureDiskCapacity((current.totalBytes ?? 0) - (current.downloadedBytes ?? 0));
    current.phase = "downloading";
    await this.persist();

    for (const file of files) {
      if (controller.signal.aborted) throw new DownloadPausedError();
      await this.downloadFileWithRetry(
        definition.id,
        definition.revision,
        file,
        controller.signal,
        current,
      );
    }

    const revisionDirectory = this.revisionDirectory(id, definition.revision);
    current.phase = "verifying";
    current.downloadedBytes = current.totalBytes;
    await this.persist();
    this.emit();
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
    current.phase = "preparing";
    current.downloadedBytes = current.totalBytes;
    current.errorMessage = undefined;
    current.failureKind = undefined;
    await this.persist();
    this.emit();

    await this.prepareRuntime(id);

    current.phase = "installed";
    await this.persist();
    this.emit();

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
    const completed = await stat(destination)
      .then((value) => ({ exists: true, size: value.size }))
      .catch(() => ({ exists: false, size: 0 }));
    if (completed.exists && completed.size === expectedSize) return;

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
      requiresHuggingFaceAuthorization:
        modelDefinition(id).requiresHuggingFaceAuthorization === true,
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
            this.updateDownloadSpeed(id, state.downloadedBytes ?? 0, now);
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

  private async downloadFileWithRetry(
    id: AiModelId,
    revision: string,
    file: DownloadModelFile,
    signal: AbortSignal,
    state: PersistedModelState,
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MODEL_FILE_DOWNLOAD_ATTEMPTS; attempt += 1) {
      try {
        await this.downloadFile(id, revision, file, signal, state);
        return;
      } catch (error) {
        if (signal.aborted || error instanceof DownloadPausedError) throw new DownloadPausedError();
        lastError = error;
        if (attempt === MODEL_FILE_DOWNLOAD_ATTEMPTS) break;
        await this.log("warn", "ai_model_file_download_retry", id, error, {
          file: file.rfilename,
          attempt,
          maxAttempts: MODEL_FILE_DOWNLOAD_ATTEMPTS,
        });
        await this.waitForDownloadRetry(attempt * 750, signal);
      }
    }
    throw lastError;
  }

  private waitForDownloadRetry(delayMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(new DownloadPausedError());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, delayMs);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new DownloadPausedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private withDownloadSlot<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    return this.acquireDownloadSlot(signal).then(async (release) => {
      try {
        return await operation();
      } finally {
        release();
      }
    });
  }

  private acquireDownloadSlot(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new DownloadPausedError());
    if (this.activeModelDownloads < MAX_CONCURRENT_MODEL_DOWNLOADS) {
      this.activeModelDownloads += 1;
      return Promise.resolve(this.createDownloadSlotRelease());
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        signal,
        resolve,
        reject,
        onAbort: () => {
          const index = this.downloadSlotWaiters.indexOf(waiter);
          if (index >= 0) this.downloadSlotWaiters.splice(index, 1);
          reject(new DownloadPausedError());
        },
      };
      signal.addEventListener("abort", waiter.onAbort, { once: true });
      this.downloadSlotWaiters.push(waiter);
    });
  }

  private createDownloadSlotRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const waiter = this.downloadSlotWaiters.shift();
      if (waiter) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
        waiter.resolve(this.createDownloadSlotRelease());
      } else {
        this.activeModelDownloads = Math.max(0, this.activeModelDownloads - 1);
      }
    };
  }

  private downloadPriority(id: AiModelId): number {
    if (id === this.activeAsrModel) return 0;
    const activeDependencies = modelDefinition(this.activeAsrModel).dependencies as
      readonly AiModelId[] | undefined;
    if (activeDependencies?.includes(id)) return 1;
    const category = modelDefinition(id).category;
    return category === "asr" ? 2 : category === "support" ? 3 : 4;
  }

  private updateDownloadSpeed(id: AiModelId, bytes: number, checkedAt: number): void {
    const previous = this.downloadSpeedSamples.get(id);
    this.downloadSpeedSamples.set(id, { bytes, checkedAt });
    if (!previous || checkedAt <= previous.checkedAt || bytes < previous.bytes) return;
    const instantaneous = ((bytes - previous.bytes) * 1_000) / (checkedAt - previous.checkedAt);
    const current = this.downloadSpeeds.get(id);
    this.downloadSpeeds.set(
      id,
      current === undefined ? instantaneous : current * 0.6 + instantaneous * 0.4,
    );
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
    await validateModelRevisionFiles(definition.id, directory, files);
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
        manifest: await this.fetchManifest(
          component,
          definition.requiresHuggingFaceAuthorization === true,
        ),
      })),
    );
    return manifests.flatMap(({ component, manifest }) =>
      manifest.siblings
        .filter((file) => {
          const size = file.lfs?.size ?? file.size;
          return typeof size === "number" && size >= 0;
        })
        .map((file): DownloadModelFile => {
          const sourceFileName = safeRelativeModelPath(file.rfilename);
          const destination = component.directory
            ? safeRelativeModelPath(`${component.directory}/${sourceFileName}`)
            : sourceFileName;
          return {
            ...file,
            size: file.lfs?.size ?? file.size,
            rfilename: destination,
            sourceFileName,
            sourceRepository: component.repository,
            sourceRevision: component.revision,
            sha256: file.lfs?.sha256,
          };
        }),
    );
  }

  private async fetchManifest(
    component: ModelComponent,
    requiresHuggingFaceAuthorization: boolean,
  ): Promise<RemoteModelManifest> {
    const { response, release } = await this.fetchFromModelSources(
      `api/models/${component.repository}/revision/${component.revision}?blobs=true`,
      {
        acceptedStatuses: [200],
        errorPrefix: "ai_model_manifest_http",
        requiresHuggingFaceAuthorization,
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
      requiresHuggingFaceAuthorization?: boolean;
    },
  ): Promise<{ response: Response; release: () => void }> {
    let lastError: unknown;
    const accessToken = options.requiresHuggingFaceAuthorization
      ? await this.readHuggingFaceAccessToken?.()
      : undefined;
    if (options.requiresHuggingFaceAuthorization && !accessToken) {
      throw new Error("ai_model_access_token_required");
    }
    const sources = options.requiresHuggingFaceAuthorization
      ? MODEL_SOURCES.filter((source) => source.baseUrl === "https://huggingface.co")
      : MODEL_SOURCES;
    for (const source of sources) {
      if (options.signal?.aborted) throw new DownloadPausedError();
      const controller = new AbortController();
      const forwardAbort = () => controller.abort();
      options.signal?.addEventListener("abort", forwardAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(), MODEL_REQUEST_TIMEOUT_MS);
      try {
        const response = await this.modelFetch(`${source.baseUrl}/${relativeUrl}`, {
          headers: accessToken
            ? { ...options.headers, Authorization: `Bearer ${accessToken}` }
            : options.headers,
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
      bytesPerSecond: this.downloadSpeeds.get(definition.id),
      errorMessage: current?.errorMessage,
      failureKind: current?.failureKind,
      runtimeReady: this.runtimeStatus[definition.id]?.ready === true,
      runtimeMessage: this.runtimeStatus[definition.id]?.message,
      dependencies: definition.dependencies ? [...definition.dependencies] : undefined,
      optionalDependencies: definition.optionalDependencies
        ? [...definition.optionalDependencies]
        : undefined,
      hardwareNote: definition.hardwareNote,
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
        try {
          await writeFile(temporary, serialized, "utf8");
          await replaceStateFile(temporary, file);
        } finally {
          await rm(temporary, { force: true }).catch(() => undefined);
        }
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
    transcriptionModel?: AiAsrModelId,
  ): {
    runnable: boolean;
    reason?: string;
    resourceMode: "low" | "normal";
    requiredModel: AiModelId;
  } {
    const requiredModel =
      kind === "transcription" ? (transcriptionModel ?? this.activeAsrModel) : "qwen35-4b";
    if (!this.persisted.models[requiredModel]?.activeRevision) {
      return {
        runnable: false,
        reason: `model_${requiredModel}_not_installed`,
        resourceMode: "low",
        requiredModel,
      };
    }
    for (const dependency of modelDefinition(requiredModel).dependencies ?? []) {
      if (!this.persisted.models[dependency]?.activeRevision) {
        return {
          runnable: false,
          reason: `model_${dependency}_not_installed`,
          resourceMode: "low",
          requiredModel,
        };
      }
      if (this.runtimeStatus[dependency]?.ready === false) {
        return {
          runnable: false,
          reason: `model_${dependency}_runtime_not_ready`,
          resourceMode: "low",
          requiredModel,
        };
      }
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
