import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_ASR_MODEL_NAMES,
  isQwenForcedAlignerModel,
  isChinesePreferredTranscriptText,
  isReliableTranscriptText,
  mergeTranscriptIntoSentences,
  type AiAsrModelId,
  type AiModelId,
  type AiAsrRuntimeStatus,
  type AiRuntimeStatus,
  type VoiceMemoryProcessingStage,
  type VoiceMemoryTranscriptSegment,
  type RendererLogPayload,
} from "@private-voice/shared";

import {
  classifyLocalModelRuntimeError,
  LocalModelRuntimeError,
  type LocalModelRuntimeHealth,
} from "./local-model-runtime";
import { QwenRuntime } from "./qwen-runtime";
import type { QwenWorkerHealth } from "./qwen-persistent-worker";
import {
  AsrPersistentWorker,
  type AsrWorkerLaunch,
  type AsrWorkerResult,
} from "./asr-persistent-worker";
import { runLocalProcess } from "./local-process";
import { resolveFfmpegExecutable } from "./media-runtime";
import { modelFilesPresent } from "./ai-model-layout";
interface RuntimeModelPaths {
  model: (id: AiModelId) => string | undefined;
  qwen: () => string | undefined;
  activeAsr: () => AiAsrModelId;
}

interface QwenGenerateOptions {
  prompt: string;
  maxNewTokens?: number;
  resourceMode: "low" | "normal";
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface PythonCudaDiagnostics {
  pythonPath: string;
  torchLocation?: string;
  torchVersion?: string;
  torchCudaVersion?: string;
  cudaAvailable: boolean;
  deviceCount: number;
  gpuNames: string[];
  computeCapabilities: string[];
  bf16Supported: boolean;
  fp16Supported: boolean;
  totalVramBytes?: number;
  torchDlls: string[];
  dllLoadFailures: string[];
  nvidiaSmiAvailable: boolean;
  nvidiaDriverVersion?: string;
  nvidiaSmiError?: string;
  cudaInitializationError?: string;
  error?: string;
  failureReason?: CudaRuntimeFailureReason;
}

export type CudaRuntimeFailureReason =
  | "python_missing"
  | "python_start_failed"
  | "torch_missing"
  | "torch_import_failed"
  | "cpu_only_pytorch"
  | "cuda_dll_load_failed"
  | "nvidia_driver_error"
  | "gpu_not_detected"
  | "cuda_runtime_missing"
  | "bf16_unsupported";

interface AiRuntimeManagerOptions {
  writeLog?: (payload: RendererLogPayload) => Promise<void>;
  probeCuda?: () => Promise<PythonCudaDiagnostics>;
}
const CUDA_TORCH_VERSION = "2.11.0";
const CUDA_TORCHAUDIO_VERSION = "2.11.0";
const CUDA_WHEEL_INDEX = "https://download.pytorch.org/whl/cu128";
const CUDA_DIAGNOSTIC_TTL_MS = 15_000;
export const PRIVATE_PIP_INSTALL_ARGUMENTS = [
  "--disable-pip-version-check",
  "--no-input",
  "--no-warn-script-location",
  "--no-cache-dir",
  "--prefer-binary",
] as const;
export const FIRE_RED_RUNTIME_PACKAGES = [
  "https://codeload.github.com/FireRedTeam/FireRedASR2S/zip/4e7d9aaf4482a47cec1724807026b9b151926eb5",
  // Required by the pinned official source but omitted from its pyproject dependencies. The
  // upstream 1.15 pin has no Windows/Python 3.12 wheel, so keep a tested compatible wheel pinned.
  "kaldi-native-fbank==1.22.3",
] as const;

export const QWEN_ORGANIZER_RUNTIME_PACKAGES = [
  "transformers==5.15.0",
  "accelerate>=1.10,<2",
] as const;

export const MOSS_RUNTIME_PACKAGES = [
  "https://codeload.github.com/OpenMOSS/MOSS-Transcribe-Diarize/zip/0e3d1403fd8f1f1c674e883ece96b9f630794ebe",
  "transformers==5.15.0",
  "accelerate>=1.10,<2",
  "librosa>=0.11,<1",
] as const;

export const DOLPHIN_RUNTIME_PACKAGES = [
  "dataoceanai-dolphin==20260513",
  "torch-complex==0.4.4",
] as const;

export const COHERE_TRANSCRIBE_RUNTIME_PACKAGES = [
  "transformers==5.15.0",
  "accelerate>=1.10,<2",
  "librosa>=0.11,<1",
] as const;

export const classifyCudaRuntimeFailure = (
  diagnostics: PythonCudaDiagnostics,
): CudaRuntimeFailureReason | undefined => {
  const error =
    `${diagnostics.error ?? ""}\n${diagnostics.cudaInitializationError ?? ""}`.toLowerCase();
  if (error.includes("ai_runtime_spawn_failed") || error.includes("spawn eperm")) {
    return "python_start_failed";
  }
  if (error.includes("no module named") && error.includes("torch")) return "torch_missing";
  if (diagnostics.error) {
    if (
      error.includes("dll") ||
      error.includes("winerror 126") ||
      error.includes("cannot load") ||
      error.includes("failed to load")
    ) {
      return "cuda_dll_load_failed";
    }
    return "torch_import_failed";
  }
  if (!diagnostics.torchCudaVersion || diagnostics.torchVersion?.toLowerCase().includes("+cpu")) {
    return "cpu_only_pytorch";
  }
  if (diagnostics.dllLoadFailures.length > 0) return "cuda_dll_load_failed";
  if (diagnostics.cudaAvailable && diagnostics.deviceCount > 0) {
    return diagnostics.bf16Supported ? undefined : "bf16_unsupported";
  }
  if (!diagnostics.nvidiaSmiAvailable || error.includes("driver") || error.includes("nvidia")) {
    return "nvidia_driver_error";
  }
  if (diagnostics.deviceCount < 1) return "gpu_not_detected";
  return "cuda_runtime_missing";
};

export const describeCudaRuntimeFailure = (
  reason: CudaRuntimeFailureReason | undefined,
  requiresBf16 = false,
): string | undefined => {
  if (requiresBf16 && reason === "bf16_unsupported")
    return "当前 NVIDIA GPU 不支持 BF16，无法运行所选完整精度模型。";
  switch (reason) {
    case "python_missing":
      return "上号独立 AI Runtime 的 Python 尚未安装。";
    case "python_start_failed":
      return "上号独立 AI Runtime 的 Python 启动失败，请查看诊断日志。";
    case "torch_missing":
      return "上号独立 AI Runtime 缺少 PyTorch，正在尝试修复。";
    case "torch_import_failed":
      return "上号独立 AI Runtime 无法加载 PyTorch，请查看诊断日志。";
    case "cpu_only_pytorch":
      return "上号独立 AI Runtime 误装了 CPU 版 PyTorch，正在尝试修复。";
    case "cuda_dll_load_failed":
      return "上号独立 AI Runtime 的 CUDA DLL 加载失败，请查看诊断日志。";
    case "nvidia_driver_error":
      return "NVIDIA 驱动异常或不可用，请检查显卡驱动。";
    case "gpu_not_detected":
      return "上号独立 AI Runtime 没有识别到 NVIDIA GPU。";
    case "cuda_runtime_missing":
      return "上号独立 AI Runtime 的 CUDA 组件不可用，请尝试修复组件。";
    case "bf16_unsupported":
      return requiresBf16 ? "当前 NVIDIA GPU 不支持 BF16，无法运行所选完整精度模型。" : undefined;
    default:
      return undefined;
  }
};

const exists = (filePath: string): Promise<boolean> =>
  access(filePath).then(
    () => true,
    () => false,
  );

export interface TorchAudioInstallPlan {
  version: string;
  indexUrl?: string;
}

/** Keeps torchaudio ABI-compatible with the portable PyTorch build already shipped by ShangHao. */
export const torchAudioInstallPlan = (torchVersion: string): TorchAudioInstallPlan => {
  const normalized = torchVersion.trim();
  const [version = "", build] = normalized.split("+", 2);
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`unsupported_torch_version:${normalized || "missing"}`);
  }
  if (!build) return { version };
  if (build === "cpu" || /^cu\d+$/.test(build)) {
    return {
      version,
      indexUrl: `https://download.pytorch.org/whl/${build}`,
    };
  }
  throw new Error(`unsupported_torch_build:${build}`);
};

export const temporaryRecordingName = (recordingId: string): string =>
  createHash("sha256").update(recordingId).digest("hex").slice(0, 20);
/** Normalize every provider to the same readable, seekable sentence shape. */
export const normalizeForcedAlignerTranscript = (
  _modelId: AiAsrModelId,
  transcript: VoiceMemoryTranscriptSegment[],
): VoiceMemoryTranscriptSegment[] => mergeTranscriptIntoSentences(transcript);

export const providerCudaErrorCode = (modelId: AiAsrModelId, bf16 = false): string => {
  const providers: Record<AiAsrModelId, string> = {
    "qwen3-asr-1.7b-force": "qwen3_asr",
    "qwen3-asr-0.6b-force": "qwen3_asr",
    "fun-asr-nano-2512": "fun_asr_nano_2512",
    "glm-asr-nano-2512": "glm_asr_nano_2512",
    "fireredasr2-aed": "fireredasr2_aed",
    "paraformer-zh": "paraformer_zh",
    "moss-transcribe-diarize-0.9b": "moss_transcribe_diarize",
    "dolphin-cn-dialect-0.4b": "dolphin_cn_dialect",
    "cohere-transcribe-2b": "cohere_transcribe",
  };
  const provider = providers[modelId];
  return `${provider}_cuda${bf16 ? "_bf16" : ""}_required`;
};

const parseTimestamp = (value: string): number => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 100_000 ? numeric : numeric * 1_000;
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0) * 1_000;
};

export interface PcmAudioActivity {
  peak: number;
  activeFrameRatio: number;
  audible: boolean;
}

/** Measures 20 ms PCM frames so a click cannot make an otherwise silent chunk look like speech. */
export const analyzePcm16Wav = (wav: Buffer): PcmAudioActivity => {
  if (
    wav.length < 44 ||
    wav.toString("ascii", 0, 4) !== "RIFF" ||
    wav.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("invalid_transcription_wav");
  }
  let cursor = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let audioFormat = 0;
  let dataStart = 0;
  let dataLength = 0;
  while (cursor + 8 <= wav.length) {
    const kind = wav.toString("ascii", cursor, cursor + 4);
    const size = wav.readUInt32LE(cursor + 4);
    const start = cursor + 8;
    if (kind === "fmt " && size >= 16 && start + 16 <= wav.length) {
      audioFormat = wav.readUInt16LE(start);
      channels = wav.readUInt16LE(start + 2);
      sampleRate = wav.readUInt32LE(start + 4);
      bitsPerSample = wav.readUInt16LE(start + 14);
    } else if (kind === "data") {
      dataStart = start;
      dataLength = Math.min(size, wav.length - start);
      break;
    }
    cursor = start + size + (size % 2);
  }
  if (audioFormat !== 1 || channels !== 1 || bitsPerSample !== 16 || !sampleRate || !dataLength) {
    throw new Error("unsupported_transcription_wav");
  }

  const frameSamples = Math.max(1, Math.round(sampleRate * 0.02));
  const samples = Math.floor(dataLength / 2);
  const totalFrames = Math.ceil(samples / frameSamples);
  let peak = 0;
  let activeFrames = 0;
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const first = frame * frameSamples;
    const last = Math.min(samples, first + frameSamples);
    let sumSquares = 0;
    for (let index = first; index < last; index += 1) {
      const amplitude = Math.abs(wav.readInt16LE(dataStart + index * 2)) / 32_768;
      peak = Math.max(peak, amplitude);
      sumSquares += amplitude * amplitude;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, last - first));
    if (rms >= 0.0025) activeFrames += 1;
  }
  const activeFrameRatio = activeFrames / Math.max(1, totalFrames);
  return {
    peak,
    activeFrameRatio,
    audible: peak >= 0.0063 && activeFrames >= Math.max(2, Math.ceil(totalFrames * 0.003)),
  };
};

export const parseVibeVoiceOutput = (
  output: string,
  recordingId: string,
  offsetMs: number,
  durationMs = 30_000,
): VoiceMemoryTranscriptSegment[] => {
  const isAcceptedTranscript = (text: string, segmentDurationMs: number): boolean =>
    isReliableTranscriptText(text, segmentDurationMs) && isChinesePreferredTranscriptText(text);
  let sanitizedOutput = "";
  for (let index = 0; index < output.length; index += 1) {
    if (output.charCodeAt(index) === 27 && output[index + 1] === "[") {
      index += 2;
      while (index < output.length && output.charCodeAt(index) < 64) index += 1;
      continue;
    }
    sanitizedOutput += output[index] ?? "";
  }
  sanitizedOutput = sanitizedOutput.replace(/^\uFEFF/, "");
  const jsonStart = sanitizedOutput.indexOf("[");
  const jsonEnd = sanitizedOutput.lastIndexOf("]");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const items = JSON.parse(sanitizedOutput.slice(jsonStart, jsonEnd + 1)) as Array<{
        Start?: string | number;
        End?: string | number;
        Speaker?: string | number;
        Content?: string;
      }>;
      if (Array.isArray(items)) {
        const parsed = items.flatMap((item, index): VoiceMemoryTranscriptSegment[] => {
          const text = typeof item.Content === "string" ? item.Content.trim() : "";
          const startMs = offsetMs + parseTimestamp(String(item.Start ?? 0));
          const endMs = Math.max(
            startMs + 100,
            offsetMs + parseTimestamp(String(item.End ?? durationMs / 1_000)),
          );
          if (!text || !isAcceptedTranscript(text, endMs - startMs)) return [];
          return [
            {
              id: `${recordingId}-${startMs}-${index}`,
              recordingId,
              startMs,
              endMs,
              text,
              speakerId: `Speaker ${item.Speaker ?? 1}`,
              confidence: "pending",
            },
          ];
        });
        if (parsed.length) return parsed;
      }
    } catch {
      // The BitNet text prompt can legitimately start with '[' without being JSON.
    }
  }
  // Local model output is parsed one line at a time, so the input is bounded.
  // eslint-disable-next-line security/detect-unsafe-regex
  const pattern = /^\[([^\]]+)\s+-\s+([^\]]+)\]\s+(?:Speaker\s+([^:]+):\s*)?(.+)$/gm;
  const segments: VoiceMemoryTranscriptSegment[] = [];
  let sawTimestampOutput = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sanitizedOutput))) {
    sawTimestampOutput = true;
    const text = match[4]?.trim();
    if (!text) continue;
    const speaker = match[3]?.trim() || "1";
    const startMs = offsetMs + parseTimestamp(match[1] ?? "0");
    const endMs = Math.max(startMs + 100, offsetMs + parseTimestamp(match[2] ?? "0"));
    if (!isAcceptedTranscript(text, endMs - startMs)) continue;
    segments.push({
      id: `${recordingId}-${startMs}-${segments.length}`,
      recordingId,
      startMs,
      endMs,
      text,
      speakerId: `Speaker ${speaker}`,
      confidence: "pending",
    });
  }
  const plain = sanitizedOutput
    .replace(/---END---/g, "")
    .replace(/^assistant\s*/i, "")
    .trim();
  if (!sawTimestampOutput && !segments.length && plain && isAcceptedTranscript(plain, durationMs)) {
    const sentences = plain
      .split(/(?<=[。！？!?])\s*|\n+/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    const parts = sentences.length ? sentences : [plain];
    const totalCharacters = Math.max(
      1,
      parts.reduce((sum, part) => sum + part.length, 0),
    );
    let elapsed = 0;
    for (const [index, text] of parts.entries()) {
      const startRatio = elapsed / totalCharacters;
      elapsed += text.length;
      const endRatio = elapsed / totalCharacters;
      const startMs = offsetMs + Math.round(durationMs * startRatio);
      const endMs = Math.max(startMs + 100, offsetMs + Math.round(durationMs * endRatio));
      segments.push({
        id: `${recordingId}-${startMs}-${index}`,
        recordingId,
        startMs,
        endMs,
        text,
        speakerId: "Speaker 1",
        confidence: "pending",
      });
    }
  }
  return segments;
};

/** Executes the downloaded models through real local Windows runtimes. */
export class AiRuntimeManager {
  private readonly pythonExecutable: string;
  private readonly qwenRunner: string;
  private readonly asrRunner: string;
  private readonly qwenAsrPythonPath: string;
  private readonly funAsrPythonPath: string;
  private readonly glmAsrPythonPath: string;
  private readonly fireRedPythonPath: string;
  private readonly mossPythonPath: string;
  private readonly dolphinPythonPath: string;
  private readonly coherePythonPath: string;
  private readonly cudaPythonPath: string;
  private readonly qwenOrganizerPythonPath: string;
  private readonly qwenWorker: QwenRuntime;
  private readonly asrWorker: AsrPersistentWorker;
  private cudaDiagnostics?: { checkedAt: number; value: PythonCudaDiagnostics };
  private cudaDiagnosticsPromise?: Promise<PythonCudaDiagnostics>;
  private cudaInitializationPromise?: Promise<PythonCudaDiagnostics>;
  private runtimePreparationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly runtimeRoot: string,
    private readonly models: RuntimeModelPaths,
    private readonly options: AiRuntimeManagerOptions = {},
  ) {
    const compactPython = path.join(runtimeRoot, "qwen", "python", "Scripts", "python.exe");
    const venvPython = path.join(runtimeRoot, "python", "Scripts", "python.exe");
    const embeddedPython = path.join(runtimeRoot, "python", "python.exe");
    this.pythonExecutable = existsSync(compactPython)
      ? compactPython
      : existsSync(venvPython)
        ? venvPython
        : embeddedPython;
    this.qwenRunner = path.join(runtimeRoot, "qwen-runner.py");
    this.asrRunner = path.join(runtimeRoot, "asr-runner.py");
    const providerRoot = path.join(runtimeRoot, "asr-python-v3");
    this.qwenAsrPythonPath = path.join(providerRoot, "qwen");
    this.funAsrPythonPath = path.join(providerRoot, "funasr");
    this.glmAsrPythonPath = path.join(providerRoot, "glm");
    this.fireRedPythonPath = path.join(providerRoot, "firered");
    this.mossPythonPath = path.join(providerRoot, "moss");
    this.dolphinPythonPath = path.join(providerRoot, "dolphin");
    this.coherePythonPath = path.join(providerRoot, "cohere");
    // Keep the shared CUDA environment versioned. Older desktop builds could create
    // cuda-python with an elevated Windows token, leaving its files unreadable to the
    // development process and making every model appear stuck at "preparing".
    this.cudaPythonPath = path.join(runtimeRoot, "cuda-python-v3");
    this.qwenOrganizerPythonPath = path.join(runtimeRoot, "organizer-python-v3");
    this.qwenWorker = new QwenRuntime(
      this.pythonExecutable,
      this.qwenRunner,
      this.models.qwen,
      this.providerPythonPath(this.qwenOrganizerPythonPath),
    );
    this.asrWorker = new AsrPersistentWorker(this.pythonExecutable, this.asrRunner);
  }

  initializeCudaRuntime(): Promise<PythonCudaDiagnostics> {
    if (this.cudaInitializationPromise) return this.cudaInitializationPromise;
    const operation = this.initializeCudaRuntimeOnce();
    this.cudaInitializationPromise = operation;
    return operation;
  }

  private async initializeCudaRuntimeOnce(): Promise<PythonCudaDiagnostics> {
    if (!(await exists(this.pythonExecutable))) {
      const missing: PythonCudaDiagnostics = {
        pythonPath: this.pythonExecutable,
        cudaAvailable: false,
        deviceCount: 0,
        gpuNames: [],
        computeCapabilities: [],
        bf16Supported: false,
        fp16Supported: false,
        torchDlls: [],
        dllLoadFailures: [],
        nvidiaSmiAvailable: false,
        failureReason: "python_missing",
      };
      await this.log("error", "AI Runtime CUDA self-check failed", {
        ...missing,
        runnerPath: this.asrRunner,
        message: describeCudaRuntimeFailure(missing.failureReason),
      });
      return missing;
    }

    const before = await this.pythonCudaDiagnostics().catch((error) => {
      const failed: PythonCudaDiagnostics = {
        pythonPath: this.pythonExecutable,
        cudaAvailable: false,
        deviceCount: 0,
        gpuNames: [],
        computeCapabilities: [],
        bf16Supported: false,
        fp16Supported: false,
        torchDlls: [],
        dllLoadFailures: [],
        nvidiaSmiAvailable: false,
        error: error instanceof Error ? error.stack : String(error),
      };
      failed.failureReason = classifyCudaRuntimeFailure(failed);
      return failed;
    });
    const reason = before.failureReason ?? classifyCudaRuntimeFailure(before);
    const repairable = new Set<CudaRuntimeFailureReason>([
      "torch_missing",
      "torch_import_failed",
      "cpu_only_pytorch",
      "cuda_dll_load_failed",
      "cuda_runtime_missing",
    ]);
    if (reason && repairable.has(reason)) {
      await this.log("warn", "AI Runtime CUDA self-check requested repair", {
        ...before,
        failureReason: reason,
        runnerPath: this.asrRunner,
        message: describeCudaRuntimeFailure(reason),
      });
      try {
        await this.ensureCudaRuntime();
      } catch (error) {
        await this.log("error", "AI Runtime CUDA automatic repair failed", {
          failureReason: reason,
          runtimePythonPath: this.pythonExecutable,
          runnerPath: this.asrRunner,
          exception: error instanceof Error ? error.stack : String(error),
        });
      }
    }
    const after =
      reason && repairable.has(reason) ? await this.pythonCudaDiagnostics(true) : before;
    const afterReason = after.failureReason ?? classifyCudaRuntimeFailure(after);
    after.failureReason = afterReason;
    await this.log(
      after.cudaAvailable && after.deviceCount > 0 ? "info" : "error",
      "AI Runtime CUDA self-check completed",
      {
        ...after,
        runnerPath: this.asrRunner,
        message: describeCudaRuntimeFailure(afterReason),
      },
    );
    return after;
  }
  onQwenState(listener: (health: QwenWorkerHealth) => void): () => void {
    return this.qwenWorker.onState(listener);
  }

  releaseQwen(reason: string): void {
    this.qwenWorker.release(reason);
  }
  releaseAsr(reason: string): void {
    this.asrWorker.release(reason);
  }
  stop(): void {
    this.qwenWorker.release("app_stopping");
    this.asrWorker.release("app_stopping");
  }

  async runtimeHealth(): Promise<LocalModelRuntimeHealth[]> {
    const modelIds: AiAsrModelId[] = [
      "qwen3-asr-1.7b-force",
      "qwen3-asr-0.6b-force",
      "fun-asr-nano-2512",
      "glm-asr-nano-2512",
      "fireredasr2-aed",
      "paraformer-zh",
      "moss-transcribe-diarize-0.9b",
      "dolphin-cn-dialect-0.4b",
      "cohere-transcribe-2b",
    ];
    const [asrStatuses, qwenStatus] = await Promise.all([
      Promise.all(modelIds.map((id) => this.asrStatus(id))),
      this.qwenOrganizerStatus(),
    ]);
    const asrWorker = this.asrWorker.health();
    const qwen = this.qwenWorker.workerHealth();
    return [
      ...asrStatuses.map((status) => ({
        id: status.modelId,
        phase: status.runtimePhase ?? "missing",
        ready: status.ready,
        loaded: asrWorker.loaded && asrWorker.modelId === status.modelId,
        executable: status.executable,
        processId: asrWorker.modelId === status.modelId ? asrWorker.processId : undefined,
        queuedJobs: asrWorker.queuedJobs,
        activeJobId: asrWorker.activeJobId,
        lastError: status.errorCode ? classifyLocalModelRuntimeError(status.errorCode) : undefined,
        detail: status.message,
      })),
      {
        id: "qwen35-4b",
        phase: qwenStatus.ready
          ? qwen.phase === "crashed"
            ? "error"
            : qwen.phase === "starting"
              ? "preparing"
              : qwen.phase
          : "missing",
        ready: qwenStatus.ready,
        loaded: qwen.loaded,
        executable: qwenStatus.executable,
        processId: qwen.processId,
        queuedJobs: qwen.queuedJobs,
        activeJobId: qwen.activeJobId,
        lastError: qwen.lastError ? classifyLocalModelRuntimeError(qwen.lastError) : undefined,
        detail: qwen.lastError ?? qwenStatus.message,
      },
    ];
  }

  async status(asrModelId?: AiAsrModelId): Promise<AiRuntimeStatus> {
    const activeAsr = asrModelId ?? this.models.activeAsr();
    const [asr, qwen] = await Promise.all([this.asrStatus(activeAsr), this.qwenOrganizerStatus()]);
    return { asr, qwen };
  }

  async modelRuntimeStatuses(): Promise<Record<AiModelId, { ready: boolean; message?: string }>> {
    const ids: AiAsrModelId[] = [
      "qwen3-asr-1.7b-force",
      "qwen3-asr-0.6b-force",
      "fun-asr-nano-2512",
      "glm-asr-nano-2512",
      "fireredasr2-aed",
      "paraformer-zh",
      "moss-transcribe-diarize-0.9b",
      "dolphin-cn-dialect-0.4b",
      "cohere-transcribe-2b",
    ];
    const [statuses, qwen] = await Promise.all([
      Promise.all(ids.map((id) => this.asrStatus(id))),
      this.qwenOrganizerStatus(),
    ]);
    const result = Object.fromEntries(
      statuses.map((status) => [status.modelId, { ready: status.ready, message: status.message }]),
    ) as Record<AiModelId, { ready: boolean; message?: string }>;
    const aligner = this.models.model("qwen3-forced-aligner-0.6b");
    const alignerReady = Boolean(
      aligner && (await modelFilesPresent("qwen3-forced-aligner-0.6b", aligner)),
    );
    return {
      ...result,
      "qwen3-forced-aligner-0.6b": {
        ready: alignerReady,
        message: alignerReady ? undefined : "Qwen 共用时间对齐组件尚未下载完整。",
      },
      "qwen35-4b": { ready: qwen.ready, message: qwen.message },
    };
  }

  private async asrStatus(modelId: AiAsrModelId): Promise<AiAsrRuntimeStatus> {
    const worker = this.asrWorker.health();
    const pythonRuntimeExists = await exists(this.pythonExecutable);
    const runnerExists = await exists(this.asrRunner);
    const model = this.models.model(modelId);
    const qwenModel = modelId.startsWith("qwen3-asr-");
    const paraformer = modelId === "paraformer-zh";
    const funAsr = modelId === "fun-asr-nano-2512" || paraformer;
    const glm = modelId === "glm-asr-nano-2512";
    const fireRed = modelId === "fireredasr2-aed";
    const moss = modelId === "moss-transcribe-diarize-0.9b";
    const dolphin = modelId === "dolphin-cn-dialect-0.4b";
    const cohere = modelId === "cohere-transcribe-2b";
    const aligner = qwenModel ? this.models.model("qwen3-forced-aligner-0.6b") : undefined;
    const modelReady = Boolean(model && (await modelFilesPresent(modelId, model)));
    const dependencyReady =
      !qwenModel ||
      Boolean(aligner && (await modelFilesPresent("qwen3-forced-aligner-0.6b", aligner)));
    const packageReady = qwenModel
      ? await exists(path.join(this.qwenAsrPythonPath, "qwen_asr", "__init__.py"))
      : funAsr
        ? (await exists(path.join(this.funAsrPythonPath, "funasr", "__init__.py"))) &&
          (!paraformer ||
            (await exists(path.join(this.cudaPythonPath, "torchaudio", "__init__.py"))))
        : glm
          ? await exists(path.join(this.glmAsrPythonPath, "transformers", "__init__.py"))
          : fireRed
            ? (await exists(path.join(this.fireRedPythonPath, "fireredasr2s", "__init__.py"))) &&
              (await exists(path.join(this.fireRedPythonPath, "kaldi_native_fbank", "__init__.py")))
            : moss
              ? (await exists(
                  path.join(this.mossPythonPath, "moss_transcribe_diarize", "__init__.py"),
                )) && (await exists(path.join(this.mossPythonPath, "transformers", "__init__.py")))
              : dolphin
                ? (await exists(path.join(this.dolphinPythonPath, "dolphin", "__init__.py"))) &&
                  (await exists(path.join(this.dolphinPythonPath, "torch_complex", "tensor.py")))
                : cohere
                  ? await exists(path.join(this.coherePythonPath, "transformers", "__init__.py"))
                  : false;
    const needsCuda = !paraformer;
    const cuda =
      needsCuda && pythonRuntimeExists
        ? await this.pythonCudaDiagnostics().catch((error) => {
            const failed: PythonCudaDiagnostics = {
              pythonPath: this.pythonExecutable,
              cudaAvailable: false,
              deviceCount: 0,
              gpuNames: [],
              computeCapabilities: [],
              bf16Supported: false,
              fp16Supported: false,
              torchDlls: [],
              dllLoadFailures: [],
              nvidiaSmiAvailable: false,
              error: error instanceof Error ? error.stack : String(error),
            };
            failed.failureReason = classifyCudaRuntimeFailure(failed);
            return failed;
          })
        : undefined;
    const needsBf16 = qwenModel || modelId === "fun-asr-nano-2512" || glm || moss || cohere;
    const cudaFailure =
      cuda?.failureReason ?? (cuda ? classifyCudaRuntimeFailure(cuda) : undefined);
    const cudaReady =
      !needsCuda ||
      Boolean(
        cuda?.cudaAvailable &&
        cuda.deviceCount > 0 &&
        (!needsBf16 || cuda.bf16Supported) &&
        (!cudaFailure || cudaFailure === "bf16_unsupported"),
      );
    const runtimeReady = pythonRuntimeExists && runnerExists && packageReady && cudaReady;
    const ready = modelReady && dependencyReady && runtimeReady;
    const missingMessage = !modelReady
      ? `${AI_ASR_MODEL_NAMES[modelId]} 尚未下载完整。`
      : !dependencyReady
        ? "Qwen 共用的 ForcedAligner 时间对齐组件尚未下载。"
        : !pythonRuntimeExists || !runnerExists || !packageReady
          ? `${AI_ASR_MODEL_NAMES[modelId]} 的官方运行组件尚未准备好。`
          : !cudaReady
            ? (describeCudaRuntimeFailure(cudaFailure, needsBf16) ??
              `${AI_ASR_MODEL_NAMES[modelId]} GPU运行环境异常，请检查AI Runtime。`)
            : worker.modelId === modelId
              ? worker.lastError
              : undefined;
    return {
      modelId,
      ready,
      executable: ready ? this.pythonExecutable : undefined,
      message: missingMessage,
      errorCode:
        !modelReady || !dependencyReady
          ? "model_missing"
          : !pythonRuntimeExists || !runnerExists || !packageReady
            ? "runtime_missing"
            : !cudaReady
              ? cudaFailure === "bf16_unsupported"
                ? "bf16_runtime_unavailable"
                : "cuda_runtime_unavailable"
              : undefined,
      outputSource: "stdout",
      modelName: AI_ASR_MODEL_NAMES[modelId],
      modelVersion: model ? path.basename(model) : undefined,
      modelPath: model,
      runtimePhase: ready
        ? worker.modelId === modelId
          ? worker.phase === "crashed"
            ? "error"
            : worker.phase === "starting"
              ? "preparing"
              : worker.phase
          : "stopped"
        : "missing",
      ffmpegPath: resolveFfmpegExecutable(),
      asrInputFormat: "PCM16 WAV / 16000 Hz / mono",
    };
  }

  private async qwenOrganizerStatus(): Promise<AiRuntimeStatus["qwen"]> {
    const qwen = this.models.qwen();
    const pythonRuntimeExists = await exists(this.pythonExecutable);
    const qwenRunnerExists = await exists(this.qwenRunner);
    const qwenDependenciesReady =
      (await exists(path.join(this.cudaPythonPath, "torch", "__init__.py"))) &&
      (await exists(path.join(this.qwenOrganizerPythonPath, "transformers", "__init__.py"))) &&
      (await exists(path.join(this.qwenOrganizerPythonPath, "accelerate", "__init__.py")));
    const qwenModelReady = Boolean(qwen && (await exists(path.join(qwen, "config.json"))));
    const qwenReady = Boolean(
      qwenModelReady && pythonRuntimeExists && qwenRunnerExists && qwenDependenciesReady,
    );
    const qwenErrorCode = !qwenModelReady
      ? "model_missing"
      : !pythonRuntimeExists || !qwenRunnerExists || !qwenDependenciesReady
        ? "runtime_missing"
        : undefined;
    const qwenWorker = this.qwenWorker.workerHealth();
    return {
      ready: qwenReady,
      executable: qwenReady ? this.pythonExecutable : undefined,
      message: qwenReady ? undefined : "Qwen 本地推理运行时尚未就绪。",
      errorCode: qwenErrorCode,
      workerPhase: qwenWorker.phase,
      loaded: qwenWorker.loaded,
      processId: qwenWorker.processId,
      queuedJobs: qwenWorker.queuedJobs,
      lastError: qwenWorker.lastError,
    };
  }

  async transcribeChunk(options: {
    modelId?: AiAsrModelId;
    recordingId: string;
    filePath: string;
    offsetMs: number;
    durationMs: number;
    signal?: AbortSignal;
    resourceMode: "low" | "normal";
    onStage?: (stage: VoiceMemoryProcessingStage, context?: Record<string, unknown>) => void;
  }): Promise<VoiceMemoryTranscriptSegment[]> {
    const executable = resolveFfmpegExecutable();
    if (!executable) {
      throw new LocalModelRuntimeError(
        "ffmpeg_missing",
        "ffmpeg_missing",
        "未找到可执行的 FFmpeg。打包版应包含 resources/ffmpeg/ffmpeg.exe。",
      );
    }
    await this.validateInputFile(options.filePath);
    const modelId = options.modelId ?? this.models.activeAsr();
    const status = await this.asrStatus(modelId);
    if (!status.ready) {
      const diagnostics = await this.pythonCudaDiagnostics(true).catch(() => undefined);
      await this.log("error", "ASR Runtime unavailable", {
        modelId,
        modelName: status.modelName,
        modelPath: status.modelPath,
        runtimePythonPath: this.pythonExecutable,
        runtimeErrorCode: status.errorCode,
        runtimeMessage: status.message,
        torchVersion: diagnostics?.torchVersion,
        torchCudaVersion: diagnostics?.torchCudaVersion,
        cudaAvailable: diagnostics?.cudaAvailable,
        deviceCount: diagnostics?.deviceCount,
        gpuNames: diagnostics?.gpuNames,
        bf16Supported: diagnostics?.bf16Supported,
        fp16Supported: diagnostics?.fp16Supported,
        totalVramBytes: diagnostics?.totalVramBytes,
        torchDlls: diagnostics?.torchDlls,
        diagnosticsError: diagnostics?.error,
      });
      if (
        status.errorCode === "cuda_runtime_unavailable" ||
        status.errorCode === "bf16_runtime_unavailable"
      ) {
        throw new Error(
          providerCudaErrorCode(modelId, status.errorCode === "bf16_runtime_unavailable"),
        );
      }
      throw new Error(`model_${modelId}_runtime_unavailable`);
    }
    const sampleRate = 16_000;
    const asrInputFormat = `PCM16 WAV / ${sampleRate} Hz / mono`;
    const temporaryDirectory = await mkdir(path.join(os.tmpdir(), "shanghao-voice-memory"), {
      recursive: true,
    }).then(() => path.join(os.tmpdir(), "shanghao-voice-memory"));
    const wavPath = path.join(
      temporaryDirectory,
      `${temporaryRecordingName(options.recordingId)}-${options.offsetMs}-${process.pid}.wav`,
    );
    try {
      try {
        options.onStage?.("convert", {
          inputFile: path.basename(options.filePath),
          outputFormat: asrInputFormat,
          ffmpegPath: executable,
        });
        await runLocalProcess(
          executable,
          [
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-ss",
            String(options.offsetMs / 1_000),
            "-t",
            String(options.durationMs / 1_000),
            "-i",
            options.filePath,
            "-vn",
            "-ac",
            "1",
            "-ar",
            String(sampleRate),
            "-c:a",
            "pcm_s16le",
            wavPath,
          ],
          { signal: options.signal, timeoutMs: 120_000 },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === "ai_task_paused") throw error;
        throw new LocalModelRuntimeError("ffmpeg_failed", "ffmpeg_failed", message);
      }
      let activity: PcmAudioActivity;
      try {
        activity = analyzePcm16Wav(await readFile(wavPath));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new LocalModelRuntimeError("wav_invalid", "wav_invalid", message);
      }
      if (!activity.audible) return [];
      options.onStage?.("asr", {
        model: status.modelName,
        modelPath: status.modelPath,
        inputFormat: asrInputFormat,
        languagePolicy: "Mandarin Chinese only",
      });
      let result: AsrWorkerResult;
      try {
        result = await this.asrWorker.run({
          launch: this.pythonAsrLaunch(modelId),
          wavPath,
          durationMs: options.durationMs,
          resourceMode: options.resourceMode,
          signal: options.signal,
          timeoutMs: Math.max(240_000, options.durationMs * 8),
        });
      } catch (error) {
        const diagnostics = await this.pythonCudaDiagnostics(true).catch(() => undefined);
        await this.log("error", "ASR Runtime transcription failed", {
          modelId,
          modelName: status.modelName,
          modelPath: status.modelPath,
          runtimePythonPath: this.pythonExecutable,
          torchVersion: diagnostics?.torchVersion,
          torchCudaVersion: diagnostics?.torchCudaVersion,
          cudaAvailable: diagnostics?.cudaAvailable,
          deviceCount: diagnostics?.deviceCount,
          gpuNames: diagnostics?.gpuNames,
          bf16Supported: diagnostics?.bf16Supported,
          fp16Supported: diagnostics?.fp16Supported,
          totalVramBytes: diagnostics?.totalVramBytes,
          torchDlls: diagnostics?.torchDlls,
          diagnosticsError: diagnostics?.error,
          pythonTraceback: this.asrWorker.health().diagnosticDetail,
          exception: error instanceof Error ? error.stack : String(error),
        });
        throw error;
      }
      options.onStage?.("transcript", {
        outputCharacters: result.text.length,
        structuredSegments: result.segments?.length ?? 0,
      });
      const segments = this.normalizePythonAsrResult(
        result,
        modelId,
        options.recordingId,
        options.offsetMs,
        options.durationMs,
      );
      // A native inference can return only unreliable repetition for very quiet/non-speech
      // chunks. Treat that as an empty transcript unit so one bad chunk cannot fail the whole
      // recording or erase useful segments already persisted from adjacent chunks.
      if (!segments.length) return [];
      return segments;
    } finally {
      await rm(wavPath, { force: true }).catch(() => undefined);
    }
  }

  async prepareModelRuntime(id: AiModelId): Promise<{ ready: boolean; message?: string }> {
    const operation = this.runtimePreparationQueue
      .catch(() => undefined)
      .then(() => this.prepareModelRuntimeOnce(id));
    this.runtimePreparationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async prepareModelRuntimeOnce(
    id: AiModelId,
  ): Promise<{ ready: boolean; message?: string }> {
    if (id === "qwen3-forced-aligner-0.6b") {
      const model = this.models.model(id);
      const installed = Boolean(model && (await modelFilesPresent(id, model)));
      return {
        ready: installed,
        message: installed ? undefined : "Qwen 共用时间对齐组件尚未下载。",
      };
    }
    if (id === "qwen35-4b") {
      const before = await this.qwenOrganizerStatus();
      if (before.ready || before.errorCode === "model_missing") {
        return { ready: before.ready, message: before.message };
      }
      if (!(await exists(this.pythonExecutable))) {
        return { ready: false, message: "便携 Python 尚未安装，无法准备本地整理组件。" };
      }
      await this.ensureCudaRuntime();
      await mkdir(this.qwenOrganizerPythonPath, { recursive: true });
      try {
        await runLocalProcess(
          this.pythonExecutable,
          [
            "-m",
            "pip",
            "install",
            ...PRIVATE_PIP_INSTALL_ARGUMENTS,
            "--upgrade",
            "--target",
            this.qwenOrganizerPythonPath,
            ...QWEN_ORGANIZER_RUNTIME_PACKAGES,
          ],
          { env: this.pipEnvironment(), timeoutMs: 20 * 60_000 },
        );
        await this.removeProviderTorchCopies(this.qwenOrganizerPythonPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Qwen 本地整理运行组件安装失败：${message}`, { cause: error });
      }
      const after = await this.qwenOrganizerStatus();
      return { ready: after.ready, message: after.message };
    }
    const before = await this.asrStatus(id);
    if (before.ready || before.errorCode === "model_missing") {
      return { ready: before.ready, message: before.message };
    }
    if (!(await exists(this.pythonExecutable))) {
      return { ready: false, message: "便携 Python 尚未安装，无法准备转录运行组件。" };
    }

    await this.ensureCudaRuntime();

    const qwenModel = id.startsWith("qwen3-asr-");
    const funAsrModel = id === "fun-asr-nano-2512" || id === "paraformer-zh";
    const glmModel = id === "glm-asr-nano-2512";
    const fireRedModel = id === "fireredasr2-aed";
    const mossModel = id === "moss-transcribe-diarize-0.9b";
    const dolphinModel = id === "dolphin-cn-dialect-0.4b";
    const cohereModel = id === "cohere-transcribe-2b";
    const pythonPath = qwenModel
      ? this.qwenAsrPythonPath
      : funAsrModel
        ? this.funAsrPythonPath
        : glmModel
          ? this.glmAsrPythonPath
          : fireRedModel
            ? this.fireRedPythonPath
            : mossModel
              ? this.mossPythonPath
              : dolphinModel
                ? this.dolphinPythonPath
                : this.coherePythonPath;
    await mkdir(pythonPath, { recursive: true });
    const commonArgs = [
      "-m",
      "pip",
      "install",
      ...PRIVATE_PIP_INSTALL_ARGUMENTS,
      "--timeout",
      "120",
      "--retries",
      "5",
      "--upgrade",
      "--target",
      pythonPath,
    ];
    try {
      if (qwenModel) {
        await runLocalProcess(this.pythonExecutable, [...commonArgs, "qwen-asr==0.0.6"], {
          env: this.pipEnvironment(),
          timeoutMs: 20 * 60_000,
        });
      } else if (funAsrModel) {
        await runLocalProcess(this.pythonExecutable, [...commonArgs, "funasr==1.4.3"], {
          env: this.pipEnvironment(),
          timeoutMs: 20 * 60_000,
        });
      } else if (glmModel) {
        await runLocalProcess(
          this.pythonExecutable,
          [...commonArgs, "transformers==5.0.0", "accelerate>=1.10,<2", "librosa>=0.11,<1"],
          { env: this.pipEnvironment(), timeoutMs: 20 * 60_000 },
        );
      } else if (fireRedModel) {
        await runLocalProcess(
          this.pythonExecutable,
          [...commonArgs, ...FIRE_RED_RUNTIME_PACKAGES],
          { env: this.pipEnvironment(), timeoutMs: 30 * 60_000 },
        );
      } else if (mossModel) {
        await runLocalProcess(this.pythonExecutable, [...commonArgs, ...MOSS_RUNTIME_PACKAGES], {
          env: this.pipEnvironment(),
          timeoutMs: 30 * 60_000,
        });
      } else if (dolphinModel) {
        const dolphinInstalled = await exists(
          path.join(this.dolphinPythonPath, "dolphin", "__init__.py"),
        );
        const complexTensorInstalled = await exists(
          path.join(this.dolphinPythonPath, "torch_complex", "tensor.py"),
        );
        const packages =
          dolphinInstalled && !complexTensorInstalled
            ? [DOLPHIN_RUNTIME_PACKAGES[1]]
            : DOLPHIN_RUNTIME_PACKAGES;
        const installArgs =
          dolphinInstalled && !complexTensorInstalled ? [...commonArgs, "--no-deps"] : commonArgs;
        await runLocalProcess(this.pythonExecutable, [...installArgs, ...packages], {
          env: this.pipEnvironment(),
          timeoutMs: 30 * 60_000,
        });
      } else if (cohereModel) {
        await runLocalProcess(
          this.pythonExecutable,
          [...commonArgs, ...COHERE_TRANSCRIBE_RUNTIME_PACKAGES],
          { env: this.pipEnvironment(), timeoutMs: 30 * 60_000 },
        );
      }
      await this.removeProviderTorchCopies(pythonPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${AI_ASR_MODEL_NAMES[id]} 官方运行组件安装失败：${message}`, {
        cause: error,
      });
    }
    await this.pythonCudaDiagnostics(true);
    const after = await this.asrStatus(id);
    return { ready: after.ready, message: after.message };
  }

  private pythonAsrLaunch(modelId: AiAsrModelId): AsrWorkerLaunch {
    const modelPath = this.models.model(modelId);
    if (!modelPath) throw new Error(`model_${modelId}_not_installed`);
    if (modelId.startsWith("qwen3-asr-")) {
      const alignerModelPath = this.models.model("qwen3-forced-aligner-0.6b");
      if (!alignerModelPath) throw new Error("model_qwen3-forced-aligner-0.6b_not_installed");
      return {
        modelId,
        modelPath,
        alignerModelPath,
        pythonPath: this.providerPythonPath(this.qwenAsrPythonPath),
      };
    }
    if (modelId === "paraformer-zh") {
      return {
        modelId,
        modelPath: path.join(modelPath, "asr"),
        vadModelPath: path.join(modelPath, "vad"),
        puncModelPath: path.join(modelPath, "punc"),
        pythonPath: this.providerPythonPath(this.funAsrPythonPath),
      };
    }
    if (modelId === "cohere-transcribe-2b") {
      const alignerModelPath = this.models.model("qwen3-forced-aligner-0.6b");
      return {
        modelId,
        modelPath,
        alignerModelPath,
        pythonPath: this.providerPythonPath(this.coherePythonPath),
      };
    }
    return {
      modelId,
      modelPath,
      pythonPath: this.providerPythonPath(
        modelId === "fun-asr-nano-2512"
          ? this.funAsrPythonPath
          : modelId === "glm-asr-nano-2512"
            ? this.glmAsrPythonPath
            : modelId === "fireredasr2-aed"
              ? this.fireRedPythonPath
              : modelId === "moss-transcribe-diarize-0.9b"
                ? this.mossPythonPath
                : this.dolphinPythonPath,
      ),
    };
  }

  async pythonCudaDiagnostics(force = false): Promise<PythonCudaDiagnostics> {
    if (!force && this.cudaDiagnostics?.checkedAt) {
      if (Date.now() - this.cudaDiagnostics.checkedAt < CUDA_DIAGNOSTIC_TTL_MS) {
        return this.cudaDiagnostics.value;
      }
    }
    if (this.cudaDiagnosticsPromise) return this.cudaDiagnosticsPromise;
    const operation = this.collectPythonCudaDiagnostics();
    this.cudaDiagnosticsPromise = operation;
    try {
      return await operation;
    } finally {
      if (this.cudaDiagnosticsPromise === operation) this.cudaDiagnosticsPromise = undefined;
    }
  }

  private async collectPythonCudaDiagnostics(): Promise<PythonCudaDiagnostics> {
    if (this.options.probeCuda) {
      const value = await this.options.probeCuda();
      this.cudaDiagnostics = { checkedAt: Date.now(), value };
      return value;
    }
    const script = [
      "import ctypes,glob,json,os,subprocess,sys,traceback",
      `result={'pythonPath':sys.executable,'cudaAvailable':False,'deviceCount':0,'gpuNames':[],'computeCapabilities':[],'bf16Supported':False,'fp16Supported':False,'torchDlls':[],'dllLoadFailures':[],'nvidiaSmiAvailable':False}`,
      "try:",
      " smi=subprocess.run(['nvidia-smi','--query-gpu=name,driver_version,compute_cap','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=15,check=False)",
      " result['nvidiaSmiAvailable']=smi.returncode==0",
      " if smi.returncode==0 and smi.stdout.strip():",
      "  first=smi.stdout.strip().splitlines()[0].split(',')",
      "  result['nvidiaDriverVersion']=first[1].strip() if len(first)>1 else None",
      " else:",
      "  result['nvidiaSmiError']=(smi.stderr or smi.stdout or f'nvidia_smi_exit_{smi.returncode}').strip()",
      "except Exception:",
      " result['nvidiaSmiError']=traceback.format_exc()",
      "try:",
      " import torch",
      " result['torchLocation']=str(torch.__file__)",
      " result['torchVersion']=str(torch.__version__)",
      " result['torchCudaVersion']=str(torch.version.cuda) if torch.version.cuda else None",
      " result['cudaAvailable']=bool(torch.cuda.is_available())",
      " result['deviceCount']=int(torch.cuda.device_count())",
      " result['gpuNames']=[torch.cuda.get_device_name(i) for i in range(result['deviceCount'])]",
      " result['computeCapabilities']=['.'.join(map(str,torch.cuda.get_device_capability(i))) for i in range(result['deviceCount'])]",
      " result['bf16Supported']=bool(result['cudaAvailable'] and torch.cuda.is_bf16_supported())",
      " result['fp16Supported']=bool(result['cudaAvailable'])",
      " result['totalVramBytes']=int(torch.cuda.get_device_properties(0).total_memory) if result['deviceCount'] else None",
      " dll_paths=glob.glob(os.path.join(os.path.dirname(torch.__file__),'lib','*.dll'))",
      " result['torchDlls']=[os.path.basename(p) for p in dll_paths]",
      " for name in ['c10_cuda.dll','cudart64_12.dll','torch_cuda.dll']:",
      "  matches=[p for p in dll_paths if os.path.basename(p).lower()==name.lower()]",
      "  if not matches:",
      "   result['dllLoadFailures'].append(f'{name}:missing')",
      "  else:",
      "   try:",
      "    ctypes.WinDLL(matches[0])",
      "   except Exception as exc:",
      "    result['dllLoadFailures'].append(f'{name}:{exc}')",
      " if not result['cudaAvailable']:",
      "  try:",
      "   torch.cuda.init()",
      "  except Exception:",
      "   result['cudaInitializationError']=traceback.format_exc()",
      "except Exception:",
      " result['error']=traceback.format_exc()",
      "print(json.dumps(result,ensure_ascii=False))",
    ].join("\n");
    const output = await runLocalProcess(this.pythonExecutable, ["-c", script], {
      env: { ...process.env, PYTHONPATH: this.cudaPythonPath },
      timeoutMs: 60_000,
    });
    const value = JSON.parse(output.stdout.trim()) as PythonCudaDiagnostics;
    value.failureReason = classifyCudaRuntimeFailure(value);
    this.cudaDiagnostics = { checkedAt: Date.now(), value };
    await this.log(value.cudaAvailable ? "info" : "error", "AI Runtime CUDA diagnostics", {
      ...value,
      runtimeRoot: this.runtimeRoot,
    });
    return value;
  }

  private async ensureCudaRuntime(): Promise<void> {
    const before = await this.pythonCudaDiagnostics(true).catch(() => undefined);
    const sharedTorchAudioReady = await exists(
      path.join(this.cudaPythonPath, "torchaudio", "__init__.py"),
    );
    if (
      before?.cudaAvailable &&
      before.deviceCount > 0 &&
      before.torchVersion?.startsWith(`${CUDA_TORCH_VERSION}+cu128`) &&
      sharedTorchAudioReady
    ) {
      return;
    }
    await mkdir(this.cudaPythonPath, { recursive: true });
    await this.log("info", "Installing official CUDA PyTorch into private AI Runtime", {
      runtimePythonPath: this.pythonExecutable,
      target: this.cudaPythonPath,
      torchVersion: CUDA_TORCH_VERSION,
      torchaudioVersion: CUDA_TORCHAUDIO_VERSION,
      indexUrl: CUDA_WHEEL_INDEX,
      previous: before,
    });
    await runLocalProcess(
      this.pythonExecutable,
      [
        "-m",
        "pip",
        "install",
        ...PRIVATE_PIP_INSTALL_ARGUMENTS,
        "--upgrade",
        "--target",
        this.cudaPythonPath,
        `torch==${CUDA_TORCH_VERSION}`,
        `torchaudio==${CUDA_TORCHAUDIO_VERSION}`,
        "--index-url",
        CUDA_WHEEL_INDEX,
      ],
      { env: this.pipEnvironment(), timeoutMs: 45 * 60_000 },
    );
    const after = await this.pythonCudaDiagnostics(true);
    if (!after.cudaAvailable || after.deviceCount < 1) {
      throw new Error("ai_runtime_cuda_install_failed");
    }
  }

  private providerPythonPath(providerPath: string): string {
    return `${this.cudaPythonPath}${path.delimiter}${providerPath}`;
  }

  private pipEnvironment(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      PIP_DISABLE_PIP_VERSION_CHECK: "1",
      PIP_NO_CACHE_DIR: "1",
      PIP_NO_INPUT: "1",
    };
  }

  private async removeProviderTorchCopies(providerPath: string): Promise<void> {
    const entries = await readdir(providerPath, { withFileTypes: true }).catch(() => []);
    const shadowing = entries.filter((entry) =>
      /^(torch|torchaudio|functorch)(?:$|[-_.])/i.test(entry.name),
    );
    await Promise.all(
      shadowing.map((entry) =>
        rm(path.join(providerPath, entry.name), { recursive: true, force: true }),
      ),
    );
  }

  private async log(
    level: RendererLogPayload["level"],
    message: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    await this.options
      .writeLog?.({ category: "app", level, message, context })
      .catch(() => undefined);
  }

  private normalizePythonAsrResult(
    result: AsrWorkerResult,
    modelId: AiAsrModelId,
    recordingId: string,
    offsetMs: number,
    durationMs: number,
  ): VoiceMemoryTranscriptSegment[] {
    const structured = (result.segments ?? []).flatMap(
      (segment, index): VoiceMemoryTranscriptSegment[] => {
        const text = segment.text.trim();
        const startMs = offsetMs + Math.max(0, Math.min(durationMs, segment.startMs));
        const endMs =
          offsetMs +
          Math.max(
            Math.min(durationMs, segment.endMs),
            Math.min(durationMs, segment.startMs + 100),
          );
        if (!text) {
          return [];
        }
        if (
          !isQwenForcedAlignerModel(modelId) &&
          (!isReliableTranscriptText(text, Math.max(100, endMs - startMs)) ||
            !isChinesePreferredTranscriptText(text))
        ) {
          return [];
        }
        return [
          {
            id: `${recordingId}-${startMs}-${index}`,
            recordingId,
            startMs,
            endMs,
            text,
            speakerId: segment.speakerId || "Speaker 1",
            confidence: "pending",
            sourceModel: modelId,
            sourceChunkId: `${modelId}:${recordingId}:${offsetMs}`,
            rawSegmentId: `${recordingId}-${offsetMs}-raw-${index}`,
            rawSegments: [JSON.stringify(segment)],
            words: segment.words?.flatMap((word, wordIndex) => {
              const wordText = word.text.trim();
              if (!wordText) return [];
              const wordStartMs = offsetMs + Math.max(0, Math.min(durationMs, word.startMs));
              const wordEndMs =
                offsetMs + Math.max(wordStartMs - offsetMs + 20, Math.min(durationMs, word.endMs));
              return [
                {
                  id: `${recordingId}-${wordStartMs}-${index}-${wordIndex}`,
                  startMs: wordStartMs,
                  endMs: wordEndMs,
                  text: wordText,
                },
              ];
            }),
          },
        ];
      },
    );
    const normalizedStructured = normalizeForcedAlignerTranscript(modelId, structured).filter(
      (segment) =>
        isReliableTranscriptText(segment.text, Math.max(100, segment.endMs - segment.startMs)) &&
        isChinesePreferredTranscriptText(segment.text),
    );
    if (normalizedStructured.length) return normalizedStructured;
    const text = result.text.trim();
    if (
      !text ||
      !isReliableTranscriptText(text, durationMs) ||
      !isChinesePreferredTranscriptText(text)
    ) {
      return [];
    }
    // Models without a reliable timestamp API are represented as one coarse chunk.
    // This is the real 30-second processing boundary, not a fabricated word/sentence alignment.
    return [
      {
        id: `${recordingId}-${offsetMs}-coarse`,
        recordingId,
        startMs: offsetMs,
        endMs: offsetMs + durationMs,
        text,
        speakerId: "Speaker 1",
        confidence: "pending",
        sourceModel: modelId,
        sourceChunkId: `${modelId}:${recordingId}:${offsetMs}`,
        rawSegmentId: `${recordingId}-${offsetMs}-raw-coarse`,
        rawSegments: [JSON.stringify({ text })],
      },
    ];
  }

  async generateJson<T>(options: QwenGenerateOptions): Promise<T> {
    const qwen = this.models.qwen();
    if (!qwen) throw new Error("model_qwen35-4b_not_installed");
    const status = await this.status();
    if (!status.qwen.ready) throw new Error("qwen_runtime_unavailable");
    const output = await this.qwenWorker.run({
      prompt: options.prompt,
      maxNewTokens: options.maxNewTokens ?? 1_024,
      resourceMode: options.resourceMode,
      timeoutMs: options.timeoutMs ?? 4 * 60_000,
      signal: options.signal,
    });
    const trimmed = output.trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end < start) throw new Error("qwen_invalid_json_response");
    return JSON.parse(trimmed.slice(start, end + 1)) as T;
  }

  async validateInputFile(filePath: string): Promise<void> {
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0) throw new Error("recording_file_unavailable");
  }
}
