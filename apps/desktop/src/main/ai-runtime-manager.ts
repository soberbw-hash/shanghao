import { existsSync } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_ASR_MODEL_NAMES,
  analyzeTranscriptAnomalies,
  isQwenForcedAlignerModel,
  isChinesePreferredTranscriptText,
  isReliableTranscriptText,
  mergeTranscriptIntoSentences,
  type AiAsrModelId,
  type AiModelId,
  type AiAsrRuntimeStatus,
  type AiRuntimeStatus,
  type VoiceMemoryProcessingStage,
  type VoiceMemoryCommonVadResult,
  type VoiceMemoryTranscriptionOutputStatus,
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
import { ACTIVE_ARK_ASR_VARIANT } from "./ark-asr-config";
import {
  downloadVerifiedRuntimeArtifact,
  sha256RuntimeArtifact,
} from "./runtime-artifact-download";
import {
  analyzePcm16Wav,
  benchmarkEnvironmentSnapshot,
  gpuMemoryUsedMb,
  modelPrecision,
  temporaryRecordingName,
  type PcmAudioActivity,
  type TranscriptionChunkRuntimeResult,
} from "./asr-benchmark-runtime";
export { analyzePcm16Wav, temporaryRecordingName } from "./asr-benchmark-runtime";
export { parseVibeVoiceOutput } from "./asr-transcript-parser";
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
  runtimeFetch?: import("./runtime-artifact-download").RuntimeArtifactFetcher;
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

const MOSS_CPP_RUNTIME_MARKER = "transcribe-cpp-0.2.3-cu12";

export const MOSS_CPP_RUNTIME_WHEELS = [
  {
    fileName: "transcribe_cpp-0.2.3-py3-none-any.whl",
    bytes: 34_910,
    sha256: "ef043b3b736049f05636f83818b130f30c7118c6d9148b1982f46ed62c10bce2",
    sources: [
      {
        url: "https://github.com/handy-computer/transcribe.cpp/releases/download/v0.2.3/transcribe_cpp-0.2.3-py3-none-any.whl",
        headers: { Accept: "application/octet-stream" },
      },
      {
        url: "https://api.github.com/repos/handy-computer/transcribe.cpp/releases/assets/536497071",
        headers: { Accept: "application/octet-stream", "User-Agent": "ShangHao-Desktop" },
      },
    ],
  },
  {
    fileName: "transcribe_cpp_native_cu12-0.2.3-py3-none-win_amd64.whl",
    bytes: 200_127_708,
    sha256: "04b35695b8d56f016cf2592460371ef5f638f06c4c4368d638a07d6812dbcafc",
    sources: [
      {
        url: "https://github.com/handy-computer/transcribe.cpp/releases/download/v0.2.3/transcribe_cpp_native_cu12-0.2.3-py3-none-win_amd64.whl",
        headers: { Accept: "application/octet-stream" },
      },
      {
        url: "https://api.github.com/repos/handy-computer/transcribe.cpp/releases/assets/536497075",
        headers: { Accept: "application/octet-stream", "User-Agent": "ShangHao-Desktop" },
      },
    ],
  },
] as const;

export const DOLPHIN_RUNTIME_PACKAGES = [
  "dataoceanai-dolphin==20260513",
  "torch-complex==0.4.4",
] as const;

// Provider wheels are installed into isolated --target directories. A stale or unreadable
// provider-local dist-info directory must not be allowed to shadow the shared dependency
// metadata used by Transformers during worker startup.
export const SHARED_PYTHON_PACKAGING_VERSION = "26.3";
export const SHARED_PYTHON_NUMPY_VERSION = "2.5.2";
const DOLPHIN_RUNTIME_MARKER = "dolphin-cn-dialect-runtime-v2";

export const COHERE_TRANSCRIBE_RUNTIME_PACKAGES = [
  "transformers==5.15.0",
  "accelerate>=1.10,<2",
  "librosa>=0.11,<1",
] as const;

export const ARK_ASR_RUNTIME_PACKAGES = [
  "https://github.com/CrispStrobe/CrispASR/releases/download/v0.8.30/crispasr-0.8.30%2Bcuda-py3-none-win_amd64.whl#sha256=be800df87c979d696f6e5e1204dc68b74cf194e58a0667ae95c430e364254cd6",
] as const;

export const ARK_ASR_RUNTIME_WHEEL = {
  fileName: "crispasr-0.8.30+cuda-py3-none-win_amd64.whl",
  bytes: 714_913_362,
  sha256: "be800df87c979d696f6e5e1204dc68b74cf194e58a0667ae95c430e364254cd6",
  sources: [
    {
      url: "https://github.com/CrispStrobe/CrispASR/releases/download/v0.8.30/crispasr-0.8.30%2Bcuda-py3-none-win_amd64.whl",
      headers: { Accept: "application/octet-stream" },
    },
    {
      url: "https://api.github.com/repos/CrispStrobe/CrispASR/releases/assets/535145440",
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "ShangHao-Desktop",
      },
    },
  ],
} as const;

/**
 * The v0.8.30 Python CUDA wheel still carries a ggml-cpu helper that raises
 * 0xC000001D on an i5-12600KF when a model session opens. The official CLI
 * bundle from the same release contains the portable CPU helper built by the
 * fixed Windows CUDA job. Overlay only that ABI-compatible DLL and keep the
 * existing persistent Python worker and benchmark pipeline.
 */
export const ARK_ASR_PORTABLE_CLI = {
  fileName: "crispasr-windows-x86_64-cuda-non-cuda.zip",
  directoryName: "crispasr-windows-x86_64-cuda-non-cuda",
  bytes: 142_370_322,
  sha256: "bc486486a9326f70ce24afe6b34d900e964ba2a0ff96c096890117821055a2df",
  cpuHelper: {
    fileName: "ggml-cpu.dll",
    bytes: 910_848,
    sha256: "d865d3f00934b53c1dbf5aa6d645235cf14d40757ef1e53ad6ab2a7f06fbe38c",
  },
  sources: [
    {
      url: "https://github.com/CrispStrobe/CrispASR/releases/download/v0.8.30/crispasr-windows-x86_64-cuda-non-cuda.zip",
      headers: { Accept: "application/octet-stream" },
    },
    {
      url: "https://api.github.com/repos/CrispStrobe/CrispASR/releases/assets/533910929",
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "ShangHao-Desktop",
      },
    },
  ],
} as const;

const ARK_ASR_RUNTIME_MARKER = [
  `wheel=${ARK_ASR_RUNTIME_WHEEL.sha256}`,
  `portableCli=${ARK_ASR_PORTABLE_CLI.sha256}`,
  `cpuHelper=${ARK_ASR_PORTABLE_CLI.cpuHelper.sha256}`,
].join("\n");

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
    "moss-transcribe-diarize-0.9b-q8_0": "moss_transcribe_diarize_q8",
    "dolphin-cn-dialect-0.4b": "dolphin_cn_dialect",
    "cohere-transcribe-2b": "cohere_transcribe",
    "ark-asr-3b-q8_0": "ark_asr_3b",
  };
  const provider = providers[modelId];
  return `${provider}_cuda${bf16 ? "_bf16" : ""}_required`;
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
  private readonly mossCppPythonPath: string;
  private readonly dolphinPythonPath: string;
  private readonly coherePythonPath: string;
  private readonly arkAsrPythonPath: string;
  private readonly arkAsrPortableCliPath: string;
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
    this.mossCppPythonPath = path.join(providerRoot, "moss-transcribe-cpp-v0.2.3-cu12");
    this.dolphinPythonPath = path.join(providerRoot, "dolphin");
    this.coherePythonPath = path.join(providerRoot, "cohere");
    // v0.8.29's Windows CUDA binary used AVX-512 and crashed with 0xC000001D on
    // otherwise supported CPUs. Keep the portable v0.8.30 runtime in a fresh versioned
    // directory so pip cannot overlay it on stale native DLLs from the broken build.
    this.arkAsrPythonPath = path.join(providerRoot, "ark-asr-v0.8.30-cuda-portable-r2");
    this.arkAsrPortableCliPath = path.join(runtimeRoot, "crispasr-v0.8.30-cuda-portable-cli");
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

  async releaseAsrMeasured(reason: string): Promise<{
    gpuMemoryAfterReleaseMb?: number;
    releaseTimeMs: number;
    resourceReleaseSucceeded: boolean;
  }> {
    const startedAt = performance.now();
    this.asrWorker.release(reason);
    const deadline = Date.now() + 2_000;
    while (this.asrWorker.health().processId && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return {
      gpuMemoryAfterReleaseMb: await gpuMemoryUsedMb(),
      releaseTimeMs: Math.max(0, Math.round(performance.now() - startedAt)),
      resourceReleaseSucceeded: !this.asrWorker.health().processId,
    };
  }

  async benchmarkEnvironment(): Promise<{
    gpu?: string;
    gpuTotalVramMb?: number;
    cpu?: string;
    ramMb?: number;
    os?: string;
    cudaVersion?: string;
    pytorchVersion?: string;
  }> {
    const diagnostics = await this.pythonCudaDiagnostics().catch(() => undefined);
    return benchmarkEnvironmentSnapshot(diagnostics);
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
      "moss-transcribe-diarize-0.9b-q8_0",
      "dolphin-cn-dialect-0.4b",
      "cohere-transcribe-2b",
      "ark-asr-3b-q8_0",
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
      "moss-transcribe-diarize-0.9b-q8_0",
      "dolphin-cn-dialect-0.4b",
      "cohere-transcribe-2b",
      "ark-asr-3b-q8_0",
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

  private async arkAsrRuntimeReady(): Promise<boolean> {
    const packageFile = path.join(this.arkAsrPythonPath, "crispasr", "__init__.py");
    const cpuHelper = path.join(
      this.arkAsrPythonPath,
      "crispasr",
      ARK_ASR_PORTABLE_CLI.cpuHelper.fileName,
    );
    const marker = await readFile(
      path.join(this.arkAsrPythonPath, ".shanghao-runtime-verified"),
      "utf8",
    ).catch(() => "");
    return (
      (await exists(packageFile)) &&
      (await exists(cpuHelper)) &&
      marker.trim() === ARK_ASR_RUNTIME_MARKER.trim()
    );
  }

  private async mossCppRuntimeReady(): Promise<boolean> {
    const marker = await readFile(
      path.join(this.mossCppPythonPath, ".shanghao-runtime-verified"),
      "utf8",
    ).catch(() => "");
    return (
      (await exists(path.join(this.mossCppPythonPath, "transcribe_cpp", "__init__.py"))) &&
      marker.trim() === MOSS_CPP_RUNTIME_MARKER
    );
  }

  private async dolphinRuntimeReady(): Promise<boolean> {
    const marker = await readFile(
      path.join(this.dolphinPythonPath, ".shanghao-runtime-verified"),
      "utf8",
    ).catch(() => "");
    return (
      (await exists(path.join(this.dolphinPythonPath, "dolphin", "__init__.py"))) &&
      (await exists(path.join(this.dolphinPythonPath, "torch_complex", "tensor.py"))) &&
      (await exists(path.join(this.cudaPythonPath, "packaging", "__init__.py"))) &&
      (await exists(
        path.join(
          this.cudaPythonPath,
          `packaging-${SHARED_PYTHON_PACKAGING_VERSION}.dist-info`,
          "METADATA",
        ),
      )) &&
      (await exists(path.join(this.cudaPythonPath, "numpy", "__init__.py"))) &&
      (await exists(
        path.join(
          this.cudaPythonPath,
          `numpy-${SHARED_PYTHON_NUMPY_VERSION}.dist-info`,
          "METADATA",
        ),
      )) &&
      marker.trim() === DOLPHIN_RUNTIME_MARKER
    );
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
    const mossCpp = modelId === "moss-transcribe-diarize-0.9b-q8_0";
    const dolphin = modelId === "dolphin-cn-dialect-0.4b";
    const cohere = modelId === "cohere-transcribe-2b";
    const arkAsr = modelId === "ark-asr-3b-q8_0";
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
              : mossCpp
                ? await this.mossCppRuntimeReady()
                : dolphin
                  ? await this.dolphinRuntimeReady()
                  : cohere
                    ? await exists(path.join(this.coherePythonPath, "transformers", "__init__.py"))
                    : arkAsr
                      ? await this.arkAsrRuntimeReady()
                      : false;
    // The transcribe.cpp CUDA package also contains a CPU backend. Keep this model usable
    // when its GPU backend is unavailable and report the backend actually selected at runtime.
    const needsCuda = !paraformer && !mossCpp;
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
    benchmark?: boolean;
    signal?: AbortSignal;
    resourceMode: "low" | "normal";
    onStage?: (stage: VoiceMemoryProcessingStage, context?: Record<string, unknown>) => void;
  }): Promise<TranscriptionChunkRuntimeResult> {
    const totalStartedAt = performance.now();
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
      const conversionStartedAt = performance.now();
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
      const conversionTimeMs = Math.max(0, Math.round(performance.now() - conversionStartedAt));
      let activity: PcmAudioActivity;
      try {
        activity = analyzePcm16Wav(await readFile(wavPath));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new LocalModelRuntimeError("wav_invalid", "wav_invalid", message);
      }
      const speechDurationMs = Math.min(
        options.durationMs,
        Math.max(0, Math.round(options.durationMs * activity.activeFrameRatio)),
      );
      const commonVad: VoiceMemoryCommonVadResult = {
        hasSpeech: activity.audible,
        speechDurationMs: activity.audible ? Math.max(1, speechDurationMs) : 0,
        silenceDurationMs: activity.audible
          ? Math.max(0, options.durationMs - Math.max(1, speechDurationMs))
          : options.durationMs,
        activeFrameRatio: activity.activeFrameRatio,
        peak: activity.peak,
      };
      if (!activity.audible) {
        return {
          segments: [],
          rawText: "",
          commonVad,
          outputStatus: "vad_silence",
          anomalyTypes: [],
          anomalyReasons: [],
          timing: {
            loadTimeMs: 0,
            conversionTimeMs,
            inferenceTimeMs: 0,
            totalTimeMs: Math.max(0, Math.round(performance.now() - totalStartedAt)),
          },
          resourceUsage: { ...modelPrecision(modelId), oomCount: 0, workerCrashCount: 0 },
        };
      }
      options.onStage?.("asr", {
        model: status.modelName,
        modelPath: status.modelPath,
        inputFormat: asrInputFormat,
        languagePolicy: "Mandarin Chinese only",
      });
      let result: AsrWorkerResult;
      const gpuMemoryBeforeLoadMb = options.benchmark ? await gpuMemoryUsedMb() : undefined;
      let gpuPeakMemoryMb = gpuMemoryBeforeLoadMb;
      let resourceSampleActive = true;
      const resourceSampler = options.benchmark
        ? setInterval(() => {
            if (!resourceSampleActive) return;
            void gpuMemoryUsedMb().then((value) => {
              if (value !== undefined) gpuPeakMemoryMb = Math.max(gpuPeakMemoryMb ?? 0, value);
            });
          }, 250)
        : undefined;
      resourceSampler?.unref();
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
        resourceSampleActive = false;
        if (resourceSampler) clearInterval(resourceSampler);
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
      resourceSampleActive = false;
      if (resourceSampler) clearInterval(resourceSampler);
      const gpuMemoryAfterLoadMb = options.benchmark ? await gpuMemoryUsedMb() : undefined;
      if (gpuMemoryAfterLoadMb !== undefined)
        gpuPeakMemoryMb = Math.max(gpuPeakMemoryMb ?? 0, gpuMemoryAfterLoadMb);
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
      const anomaly = analyzeTranscriptAnomalies(result.text, options.durationMs);
      const anomalyTypes: TranscriptionChunkRuntimeResult["anomalyTypes"] = [];
      if (anomaly.repetitionLoop) anomalyTypes.push("repetition_loop");
      if (anomaly.abnormalOutput && !anomaly.repetitionLoop) anomalyTypes.push("abnormal_output");
      const outputStatus: VoiceMemoryTranscriptionOutputStatus = anomaly.repetitionLoop
        ? "repetition_loop"
        : anomaly.abnormalOutput
          ? "abnormal_output"
          : segments.length > 0
            ? "normal"
            : "empty_output_on_speech";
      return {
        segments,
        rawText: result.text,
        rawOutput: result,
        commonVad,
        outputStatus,
        anomalyTypes,
        anomalyReasons: anomaly.reasons,
        timing: {
          loadTimeMs: result.metrics?.loadTimeMs,
          conversionTimeMs,
          inferenceTimeMs: result.metrics?.inferenceTimeMs,
          totalTimeMs: Math.max(0, Math.round(performance.now() - totalStartedAt)),
        },
        resourceUsage: {
          ...modelPrecision(modelId),
          ...(result.metrics?.backend ? { backend: result.metrics.backend } : {}),
          ...(result.metrics?.device ? { device: result.metrics.device } : {}),
          ...(result.metrics?.quantization ? { quantization: result.metrics.quantization } : {}),
          ...(result.metrics?.dtype ? { dtype: result.metrics.dtype } : {}),
          gpuMemoryBeforeLoadMb,
          gpuMemoryAfterLoadMb,
          gpuPeakMemoryMb,
          oomCount: 0,
          workerCrashCount: 0,
        },
      };
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
    if (id === "qwen36-35b-a3b-nvfp4") {
      return {
        ready: false,
        message: "Qwen3.6-35B-A3B 的 FreeToken Windows 运行组件由上号内部托管。",
      };
    }
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

    const mossCppModel = id === "moss-transcribe-diarize-0.9b-q8_0";
    if (!mossCppModel) await this.ensureCudaRuntime();

    const qwenModel = id.startsWith("qwen3-asr-");
    const funAsrModel = id === "fun-asr-nano-2512" || id === "paraformer-zh";
    const glmModel = id === "glm-asr-nano-2512";
    const fireRedModel = id === "fireredasr2-aed";
    const mossModel = id === "moss-transcribe-diarize-0.9b";
    const dolphinModel = id === "dolphin-cn-dialect-0.4b";
    const cohereModel = id === "cohere-transcribe-2b";
    const arkAsrModel = id === "ark-asr-3b-q8_0";
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
              : mossCppModel
                ? this.mossCppPythonPath
                : dolphinModel
                  ? this.dolphinPythonPath
                  : cohereModel
                    ? this.coherePythonPath
                    : this.arkAsrPythonPath;
    await mkdir(pythonPath, { recursive: true });

    if (dolphinModel) {
      await this.ensureDolphinSharedMetadata();
      const providerFilesPresent =
        (await exists(path.join(this.dolphinPythonPath, "dolphin", "__init__.py"))) &&
        (await exists(path.join(this.dolphinPythonPath, "torch_complex", "tensor.py")));
      if (providerFilesPresent) {
        try {
          await this.verifyDolphinRuntime();
          await this.pythonCudaDiagnostics(true);
          const repaired = await this.asrStatus(id);
          return { ready: repaired.ready, message: repaired.message };
        } catch (error) {
          await this.log("warn", "Dolphin Runtime preflight failed; reinstalling provider", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
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
      } else if (mossCppModel) {
        await this.prepareMossCppRuntime();
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
      } else if (arkAsrModel) {
        if (!(await exists(path.join(pythonPath, "crispasr", "__init__.py")))) {
          const runtimeWheel = await this.prepareArkAsrRuntimeWheel();
          await runLocalProcess("tar.exe", ["-xf", runtimeWheel, "-C", pythonPath], {
            timeoutMs: 10 * 60_000,
          });
        }
        await this.prepareArkAsrPortableCpuHelper(pythonPath);
      }
      await this.removeProviderTorchCopies(pythonPath);
      if (dolphinModel) {
        await this.ensureDolphinSharedMetadata();
        await this.verifyDolphinRuntime();
      }
      if (arkAsrModel) {
        await this.verifyArkAsrRuntime(pythonPath);
      }
      if (mossCppModel) {
        await this.verifyMossCppRuntime();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${AI_ASR_MODEL_NAMES[id]} 官方运行组件安装失败：${message}`, {
        cause: error,
      });
    }
    if (!mossCppModel) await this.pythonCudaDiagnostics(true);
    const after = await this.asrStatus(id);
    return { ready: after.ready, message: after.message };
  }

  private async prepareArkAsrRuntimeWheel(): Promise<string> {
    const destination = path.join(
      this.runtimeRoot,
      "downloads",
      "runtime-wheels",
      ARK_ASR_RUNTIME_WHEEL.fileName,
    );
    try {
      return await downloadVerifiedRuntimeArtifact({
        destination,
        expectedBytes: ARK_ASR_RUNTIME_WHEEL.bytes,
        expectedSha256: ARK_ASR_RUNTIME_WHEEL.sha256,
        sources: ARK_ASR_RUNTIME_WHEEL.sources,
        fetcher: this.options.runtimeFetch,
        attempts: 6,
        idleTimeoutMs: 120_000,
        onRetry: async ({ attempt, source, error }) => {
          await this.log("warn", "ARK-ASR runtime artifact download retry", {
            attempt,
            source: source.url,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      });
    } catch (error) {
      await this.log("error", "ARK-ASR runtime artifact download failed", {
        destination,
        error: error instanceof Error ? error.message : String(error),
        cause:
          error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined,
      });
      throw new Error(
        "CrispASR GPU 运行组件下载中断，已保留下载进度；请检查网络后再次点击“修复运行组件”继续。",
        { cause: error },
      );
    }
  }

  private async prepareMossCppRuntime(): Promise<void> {
    const wheelDirectory = path.join(this.runtimeRoot, "downloads", "runtime-wheels");
    await mkdir(wheelDirectory, { recursive: true });
    const wheels: string[] = [];
    for (const artifact of MOSS_CPP_RUNTIME_WHEELS) {
      const destination = path.join(wheelDirectory, artifact.fileName);
      wheels.push(
        await downloadVerifiedRuntimeArtifact({
          destination,
          expectedBytes: artifact.bytes,
          expectedSha256: artifact.sha256,
          sources: artifact.sources,
          fetcher: this.options.runtimeFetch,
          attempts: 6,
          idleTimeoutMs: 120_000,
          onRetry: async ({ attempt, source, error }) => {
            await this.log("warn", "MOSS Q8 runtime artifact download retry", {
              attempt,
              source: source.url,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        }),
      );
    }
    await mkdir(this.mossCppPythonPath, { recursive: true });
    await runLocalProcess(
      this.pythonExecutable,
      [
        "-m",
        "pip",
        "install",
        ...PRIVATE_PIP_INSTALL_ARGUMENTS,
        "--upgrade",
        "--no-deps",
        "--target",
        this.mossCppPythonPath,
        ...wheels,
      ],
      { env: this.pipEnvironment(), timeoutMs: 15 * 60_000 },
    );
  }

  private async verifyMossCppRuntime(): Promise<void> {
    const script = [
      "import transcribe_cpp",
      "devices = transcribe_cpp.backends()",
      "assert devices, 'transcribe_cpp_no_backend'",
      "print('|'.join(f'{device.device_type}:{device.name}' for device in devices))",
    ].join("\n");
    try {
      await runLocalProcess(this.pythonExecutable, ["-c", script], {
        env: {
          ...this.pipEnvironment(),
          PYTHONPATH: this.providerPythonPath(this.mossCppPythonPath),
          TRANSCRIBE_NATIVE_PROVIDER: "cu12",
        },
        timeoutMs: 3 * 60_000,
      });
      await writeFile(
        path.join(this.mossCppPythonPath, ".shanghao-runtime-verified"),
        `${MOSS_CPP_RUNTIME_MARKER}\n`,
        "utf8",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`MOSS Q8 运行组件自检失败：${message}`, { cause: error });
    }
  }

  private async isVerifiedArkAsrCpuHelper(filePath: string): Promise<boolean> {
    const info = await stat(filePath).catch(() => undefined);
    if (!info?.isFile() || info.size !== ARK_ASR_PORTABLE_CLI.cpuHelper.bytes) return false;
    return (
      (await sha256RuntimeArtifact(filePath).catch(() => "")) ===
      ARK_ASR_PORTABLE_CLI.cpuHelper.sha256
    );
  }

  private async prepareArkAsrPortableCpuHelper(pythonPath: string): Promise<void> {
    const destination = path.join(pythonPath, "crispasr", ARK_ASR_PORTABLE_CLI.cpuHelper.fileName);
    if (await this.isVerifiedArkAsrCpuHelper(destination)) return;

    const extracted = path.join(
      this.arkAsrPortableCliPath,
      ARK_ASR_PORTABLE_CLI.directoryName,
      ARK_ASR_PORTABLE_CLI.cpuHelper.fileName,
    );
    if (!(await this.isVerifiedArkAsrCpuHelper(extracted))) {
      const archive = path.join(this.runtimeRoot, "downloads", ARK_ASR_PORTABLE_CLI.fileName);
      try {
        await downloadVerifiedRuntimeArtifact({
          destination: archive,
          expectedBytes: ARK_ASR_PORTABLE_CLI.bytes,
          expectedSha256: ARK_ASR_PORTABLE_CLI.sha256,
          sources: ARK_ASR_PORTABLE_CLI.sources,
          fetcher: this.options.runtimeFetch,
          attempts: 6,
          idleTimeoutMs: 120_000,
          onRetry: async ({ attempt, source, error }) => {
            await this.log("warn", "ARK-ASR portable CPU helper download retry", {
              attempt,
              source: source.url,
              error: error instanceof Error ? error.message : String(error),
            });
          },
        });
        await mkdir(this.arkAsrPortableCliPath, { recursive: true });
        await runLocalProcess("tar.exe", ["-xf", archive, "-C", this.arkAsrPortableCliPath], {
          timeoutMs: 10 * 60_000,
        });
      } catch (error) {
        await this.log("error", "ARK-ASR portable CPU helper preparation failed", {
          archive,
          destination,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          "CrispASR 便携 CPU 兼容组件准备失败；已保留下载进度，请再次点击“修复运行组件”。",
          { cause: error },
        );
      }
    }

    if (!(await this.isVerifiedArkAsrCpuHelper(extracted))) {
      throw new Error("ark_asr_portable_cpu_helper_verification_failed");
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(extracted, destination);
    if (!(await this.isVerifiedArkAsrCpuHelper(destination))) {
      throw new Error("ark_asr_portable_cpu_helper_copy_failed");
    }
  }

  private async verifyArkAsrRuntime(pythonPath: string): Promise<void> {
    const modelRoot = this.models.model("ark-asr-3b-q8_0");
    if (!modelRoot) throw new Error("model_ark-asr-3b-q8_0_not_installed");
    const modelFile = path.join(modelRoot, ACTIVE_ARK_ASR_VARIANT.fileName);
    const script = [
      "import sys",
      "sys.path.insert(0, sys.argv[1])",
      "from crispasr import Session",
      "backends = Session.available_backends()",
      "assert 'ark-asr' in backends, f'ark_asr_backend_missing:{backends}'",
      "session = Session(sys.argv[2], n_threads=1, backend='ark-asr')",
      "close = getattr(session, 'close', None)",
      "close() if callable(close) else None",
      "print('ark_asr_runtime_verified')",
    ].join("\n");
    try {
      await runLocalProcess(this.pythonExecutable, ["-c", script, pythonPath, modelFile], {
        env: { ...this.pipEnvironment(), PYTHONPATH: this.providerPythonPath(pythonPath) },
        timeoutMs: 3 * 60_000,
      });
      await writeFile(
        path.join(pythonPath, ".shanghao-runtime-verified"),
        `${ARK_ASR_RUNTIME_MARKER}\n`,
        "utf8",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        /(?:0xc000001d|-1073741795|3221225501)/i.test(message)
          ? "ARK-ASR Q8 原生运行组件触发 CPU 非法指令；请重新点击修复运行组件安装便携版。"
          : `ARK-ASR Q8 运行组件自检失败：${message}`,
        { cause: error },
      );
    }
  }

  private async ensureDolphinSharedMetadata(): Promise<void> {
    const packageFile = path.join(this.cudaPythonPath, "packaging", "__init__.py");
    const metadataFile = path.join(
      this.cudaPythonPath,
      `packaging-${SHARED_PYTHON_PACKAGING_VERSION}.dist-info`,
      "METADATA",
    );
    const numpyPackageFile = path.join(this.cudaPythonPath, "numpy", "__init__.py");
    const numpyMetadataFile = path.join(
      this.cudaPythonPath,
      `numpy-${SHARED_PYTHON_NUMPY_VERSION}.dist-info`,
      "METADATA",
    );
    if (
      (await exists(packageFile)) &&
      (await exists(metadataFile)) &&
      (await exists(numpyPackageFile)) &&
      (await exists(numpyMetadataFile))
    )
      return;
    await mkdir(this.cudaPythonPath, { recursive: true });
    await runLocalProcess(
      this.pythonExecutable,
      [
        "-m",
        "pip",
        "install",
        ...PRIVATE_PIP_INSTALL_ARGUMENTS,
        "--upgrade",
        "--no-deps",
        "--target",
        this.cudaPythonPath,
        `packaging==${SHARED_PYTHON_PACKAGING_VERSION}`,
        `numpy==${SHARED_PYTHON_NUMPY_VERSION}`,
      ],
      { env: this.pipEnvironment(), timeoutMs: 5 * 60_000 },
    );
  }

  private async verifyDolphinRuntime(): Promise<void> {
    const script = [
      "from importlib.metadata import version",
      "assert version('packaging') == '" + SHARED_PYTHON_PACKAGING_VERSION + "'",
      "assert version('numpy') == '" + SHARED_PYTHON_NUMPY_VERSION + "'",
      "import transformers",
      "import torch_complex",
      "import dolphin",
      "print('dolphin_runtime_verified')",
    ].join("\n");
    try {
      await runLocalProcess(this.pythonExecutable, ["-c", script], {
        env: {
          ...this.pipEnvironment(),
          PYTHONPATH: this.providerPythonPath(this.dolphinPythonPath),
        },
        timeoutMs: 3 * 60_000,
      });
      await writeFile(
        path.join(this.dolphinPythonPath, ".shanghao-runtime-verified"),
        `${DOLPHIN_RUNTIME_MARKER}\n`,
        "utf8",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Dolphin 运行组件自检失败：${message}`, { cause: error });
    }
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
    if (modelId === "ark-asr-3b-q8_0") {
      return {
        modelId,
        modelPath: path.join(modelPath, ACTIVE_ARK_ASR_VARIANT.fileName),
        pythonPath: this.providerPythonPath(this.arkAsrPythonPath),
      };
    }
    if (modelId === "moss-transcribe-diarize-0.9b-q8_0") {
      return {
        modelId,
        modelPath: path.join(modelPath, "MOSS-Transcribe-Diarize-Q8_0.gguf"),
        pythonPath: this.providerPythonPath(this.mossCppPythonPath),
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
