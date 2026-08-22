import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AI_ASR_MODEL_NAMES,
  isChinesePreferredTranscriptText,
  isReliableTranscriptText,
  type AiAsrModelId,
  type AiModelId,
  type AiAsrRuntimeStatus,
  type AiRuntimeStatus,
  type VoiceMemoryProcessingStage,
  type VoiceMemoryTranscriptSegment,
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
  private readonly qwenWorker: QwenRuntime;
  private readonly asrWorker: AsrPersistentWorker;

  constructor(
    private readonly runtimeRoot: string,
    private readonly models: RuntimeModelPaths,
  ) {
    const compactPython = path.join(runtimeRoot, "qwen", "python", "Scripts", "python.exe");
    this.pythonExecutable = existsSync(compactPython)
      ? compactPython
      : path.join(runtimeRoot, "python", "Scripts", "python.exe");
    this.qwenRunner = path.join(runtimeRoot, "qwen-runner.py");
    this.asrRunner = path.join(runtimeRoot, "asr-runner.py");
    this.qwenAsrPythonPath = path.join(runtimeRoot, "asr-python", "qwen");
    this.funAsrPythonPath = path.join(runtimeRoot, "asr-python", "funasr");
    this.glmAsrPythonPath = path.join(runtimeRoot, "asr-python", "glm");
    this.fireRedPythonPath = path.join(runtimeRoot, "asr-python", "firered");
    this.qwenWorker = new QwenRuntime(this.pythonExecutable, this.qwenRunner, this.models.qwen);
    this.asrWorker = new AsrPersistentWorker(this.pythonExecutable, this.asrRunner);
  }

  onQwenState(listener: (health: QwenWorkerHealth) => void): () => void {
    return this.qwenWorker.onState(listener);
  }

  releaseQwen(reason: string): void {
    this.qwenWorker.release(reason);
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
    ];
    const [statuses, qwen] = await Promise.all([
      Promise.all(ids.map((id) => this.asrStatus(id))),
      this.qwenOrganizerStatus(),
    ]);
    const result = Object.fromEntries(
      statuses.map((status) => [status.modelId, { ready: status.ready, message: status.message }]),
    ) as Record<AiModelId, { ready: boolean; message?: string }>;
    const aligner = this.models.model("qwen3-forced-aligner-0.6b");
    return {
      ...result,
      "qwen3-forced-aligner-0.6b": {
        ready: Boolean(aligner),
        message: aligner ? undefined : "Qwen 共用时间对齐组件尚未下载。",
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
    const aligner = qwenModel ? this.models.model("qwen3-forced-aligner-0.6b") : undefined;
    const modelReady = Boolean(
      model &&
      (paraformer
        ? (await exists(path.join(model, "asr", "model.pt"))) &&
          (await exists(path.join(model, "vad", "model.pt"))) &&
          (await exists(path.join(model, "punc", "model.pt")))
        : await exists(path.join(model, "config.json"))),
    );
    const dependencyReady = !qwenModel || Boolean(aligner);
    const packageReady = qwenModel
      ? await exists(path.join(this.qwenAsrPythonPath, "qwen_asr", "__init__.py"))
      : funAsr
        ? (await exists(path.join(this.funAsrPythonPath, "funasr", "__init__.py"))) &&
          (!paraformer ||
            (await exists(path.join(this.funAsrPythonPath, "torchaudio", "__init__.py"))))
        : glm
          ? await exists(path.join(this.glmAsrPythonPath, "transformers", "__init__.py"))
          : fireRed
            ? await exists(path.join(this.fireRedPythonPath, "fireredasr2s", "__init__.py"))
            : false;
    const runtimeReady = pythonRuntimeExists && runnerExists && packageReady;
    const ready = modelReady && dependencyReady && runtimeReady;
    const missingMessage = !modelReady
      ? `${AI_ASR_MODEL_NAMES[modelId]} 尚未下载完整。`
      : !dependencyReady
        ? "Qwen 共用的 ForcedAligner 时间对齐组件尚未下载。"
        : !runtimeReady
          ? `${AI_ASR_MODEL_NAMES[modelId]} 的官方运行组件尚未准备好。`
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
          : !runtimeReady
            ? "runtime_missing"
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
    const pythonRoot = path.dirname(path.dirname(this.pythonExecutable));
    const pythonRuntimeExists = await exists(this.pythonExecutable);
    const qwenRunnerExists = await exists(this.qwenRunner);
    const qwenDependenciesReady =
      (await exists(path.join(pythonRoot, "Lib", "site-packages", "torch", "__init__.py"))) &&
      (await exists(path.join(pythonRoot, "Lib", "site-packages", "transformers", "__init__.py")));
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
    if (!status.ready) throw new Error(`model_${modelId}_runtime_unavailable`);
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
      const result = await this.asrWorker.run({
        launch: this.pythonAsrLaunch(modelId),
        wavPath,
        durationMs: options.durationMs,
        resourceMode: options.resourceMode,
        signal: options.signal,
        timeoutMs: Math.max(240_000, options.durationMs * 8),
      });
      options.onStage?.("transcript", {
        outputCharacters: result.text.length,
        structuredSegments: result.segments?.length ?? 0,
      });
      const segments = this.normalizePythonAsrResult(
        result,
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
    if (id === "qwen3-forced-aligner-0.6b") {
      const installed = Boolean(this.models.model(id));
      return {
        ready: installed,
        message: installed ? undefined : "Qwen 共用时间对齐组件尚未下载。",
      };
    }
    if (id === "qwen35-4b") {
      const status = await this.qwenOrganizerStatus();
      return { ready: status.ready, message: status.message };
    }
    const before = await this.asrStatus(id);
    if (before.ready || before.errorCode === "model_missing") {
      return { ready: before.ready, message: before.message };
    }
    if (!(await exists(this.pythonExecutable))) {
      return { ready: false, message: "便携 Python 尚未安装，无法准备转录运行组件。" };
    }

    const qwenModel = id.startsWith("qwen3-asr-");
    const funAsrModel = id === "fun-asr-nano-2512" || id === "paraformer-zh";
    const glmModel = id === "glm-asr-nano-2512";
    const fireRedModel = id === "fireredasr2-aed";
    const pythonPath = qwenModel
      ? this.qwenAsrPythonPath
      : funAsrModel
        ? this.funAsrPythonPath
        : glmModel
          ? this.glmAsrPythonPath
          : this.fireRedPythonPath;
    await mkdir(pythonPath, { recursive: true });
    const commonArgs = [
      "-m",
      "pip",
      "install",
      "--disable-pip-version-check",
      "--no-input",
      "--no-warn-script-location",
      "--prefer-binary",
      "--upgrade",
      "--target",
      pythonPath,
    ];
    try {
      if (qwenModel) {
        await runLocalProcess(this.pythonExecutable, [...commonArgs, "qwen-asr==0.0.6"], {
          timeoutMs: 20 * 60_000,
        });
      } else if (funAsrModel) {
        await runLocalProcess(this.pythonExecutable, [...commonArgs, "funasr==1.4.3"], {
          timeoutMs: 20 * 60_000,
        });
        if (id === "paraformer-zh") {
          const torchVersion = (
            await runLocalProcess(
              this.pythonExecutable,
              ["-c", "import torch; print(torch.__version__)"],
              { timeoutMs: 30_000 },
            )
          ).stdout.trim();
          const torchaudio = torchAudioInstallPlan(torchVersion);
          const torchaudioArgs = [...commonArgs, "--no-deps", `torchaudio==${torchaudio.version}`];
          if (torchaudio.indexUrl) torchaudioArgs.push("--index-url", torchaudio.indexUrl);
          await runLocalProcess(this.pythonExecutable, torchaudioArgs, {
            timeoutMs: 20 * 60_000,
          });
        }
      } else if (glmModel) {
        await runLocalProcess(
          this.pythonExecutable,
          [...commonArgs, "transformers==5.0.0", "accelerate>=1.10,<2", "librosa>=0.11,<1"],
          { timeoutMs: 20 * 60_000 },
        );
      } else if (fireRedModel) {
        await runLocalProcess(
          this.pythonExecutable,
          [
            ...commonArgs,
            "https://github.com/FireRedTeam/FireRedASR2S/archive/4e7d9aaf4482a47cec1724807026b9b151926eb5.zip",
          ],
          { timeoutMs: 30 * 60_000 },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${AI_ASR_MODEL_NAMES[id]} 官方运行组件安装失败：${message}`, {
        cause: error,
      });
    }
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
        pythonPath: this.qwenAsrPythonPath,
      };
    }
    if (modelId === "paraformer-zh") {
      return {
        modelId,
        modelPath: path.join(modelPath, "asr"),
        vadModelPath: path.join(modelPath, "vad"),
        puncModelPath: path.join(modelPath, "punc"),
        pythonPath: this.funAsrPythonPath,
      };
    }
    return {
      modelId,
      modelPath,
      pythonPath:
        modelId === "fun-asr-nano-2512"
          ? this.funAsrPythonPath
          : modelId === "glm-asr-nano-2512"
            ? this.glmAsrPythonPath
            : this.fireRedPythonPath,
    };
  }

  private normalizePythonAsrResult(
    result: AsrWorkerResult,
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
        if (
          !text ||
          !isReliableTranscriptText(text, Math.max(100, endMs - startMs)) ||
          !isChinesePreferredTranscriptText(text)
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
            speakerId: "Speaker 1",
            confidence: "pending",
          },
        ];
      },
    );
    if (structured.length) return structured;
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
      // Qwen3.5-4B is intentionally kept in a background worker. On this
      // machine a cold worker plus a structured Chinese response can take
      // longer than the old two-minute watchdog, even when the runtime is
      // healthy. Callers may use a shorter timeout for interactive tasks.
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
