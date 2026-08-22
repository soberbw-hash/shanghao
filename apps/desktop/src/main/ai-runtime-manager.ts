import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
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
import { VibeVoiceRuntime } from "./vibevoice-runtime";
import { resolveFfmpegExecutable } from "./media-runtime";

interface RuntimeModelPaths {
  vibevoice: () => string | undefined;
  qwen3Asr: () => string | undefined;
  paraformer: () => string | undefined;
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
  private readonly qwen3AsrPythonPath: string;
  private readonly funasrPythonPath: string;
  private readonly vibeExecutable: string;
  private readonly mingwBin: string;
  private readonly qwenWorker: QwenRuntime;
  private readonly vibeRuntime: VibeVoiceRuntime;
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
    this.qwen3AsrPythonPath = path.join(runtimeRoot, "qwen3-asr-python");
    this.funasrPythonPath = path.join(runtimeRoot, "funasr-python");
    const compactVibe = path.join(runtimeRoot, "vibevoice", "asr_infer.exe");
    const compactMandarinVibe = path.join(runtimeRoot, "vibevoice", "asr_infer-mandarin.exe");
    const sourceMandarinVibe = path.join(
      runtimeRoot,
      "VibeASR.cpp",
      "build",
      "bin",
      "asr_infer-mandarin.exe",
    );
    const sourceVibe = path.join(runtimeRoot, "VibeASR.cpp", "build", "bin", "asr_infer.exe");
    this.vibeExecutable = existsSync(compactMandarinVibe)
      ? compactMandarinVibe
      : existsSync(sourceMandarinVibe)
        ? sourceMandarinVibe
        : existsSync(compactVibe)
          ? compactVibe
          : sourceVibe;
    this.mingwBin =
      existsSync(compactMandarinVibe) || existsSync(compactVibe)
        ? path.dirname(existsSync(compactMandarinVibe) ? compactMandarinVibe : compactVibe)
        : path.join(runtimeRoot, "mingw64", "bin");
    this.vibeRuntime = new VibeVoiceRuntime(
      this.vibeExecutable,
      this.mingwBin,
      this.models.vibevoice,
    );
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
    this.vibeRuntime.release("app_stopping");
    this.asrWorker.release("app_stopping");
  }

  async runtimeHealth(): Promise<LocalModelRuntimeHealth[]> {
    const [vibeStatus, qwen3Status, paraformerStatus, qwenStatus] = await Promise.all([
      this.asrStatus("vibevoice"),
      this.asrStatus("qwen3-asr-0.6b"),
      this.asrStatus("paraformer-zh"),
      this.qwenOrganizerStatus(),
    ]);
    const vibe = await this.vibeRuntime.health();
    const asrWorker = this.asrWorker.health();
    const qwen = this.qwenWorker.workerHealth();
    return [
      {
        id: "vibevoice",
        phase: vibe.phase,
        ready: vibeStatus.ready,
        loaded: vibe.loaded,
        executable: vibeStatus.executable,
        queuedJobs: 0,
        activeJobId: vibe.activeJobId,
        lastError: vibe.lastError,
        detail: vibeStatus.message,
      },
      {
        id: "qwen3-asr-0.6b",
        phase: qwen3Status.runtimePhase ?? "missing",
        ready: qwen3Status.ready,
        loaded: asrWorker.loaded && asrWorker.modelId === "qwen3-asr-0.6b",
        executable: qwen3Status.executable,
        processId: asrWorker.modelId === "qwen3-asr-0.6b" ? asrWorker.processId : undefined,
        queuedJobs: asrWorker.queuedJobs,
        activeJobId: asrWorker.activeJobId,
        lastError: qwen3Status.errorCode
          ? classifyLocalModelRuntimeError(qwen3Status.errorCode)
          : undefined,
        detail: qwen3Status.message,
      },
      {
        id: "paraformer-zh",
        phase: paraformerStatus.runtimePhase ?? "missing",
        ready: paraformerStatus.ready,
        loaded: asrWorker.loaded && asrWorker.modelId === "paraformer-zh",
        executable: paraformerStatus.executable,
        processId: asrWorker.modelId === "paraformer-zh" ? asrWorker.processId : undefined,
        queuedJobs: asrWorker.queuedJobs,
        activeJobId: asrWorker.activeJobId,
        lastError: paraformerStatus.errorCode
          ? classifyLocalModelRuntimeError(paraformerStatus.errorCode)
          : undefined,
        detail: paraformerStatus.message,
      },
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

  async status(): Promise<AiRuntimeStatus> {
    const activeAsr = this.models.activeAsr();
    const [asr, vibevoice, qwen] = await Promise.all([
      this.asrStatus(activeAsr),
      this.asrStatus("vibevoice"),
      this.qwenOrganizerStatus(),
    ]);
    return { asr, vibevoice, qwen };
  }

  async modelRuntimeStatuses(): Promise<Record<AiModelId, { ready: boolean; message?: string }>> {
    const [vibevoice, qwen3, paraformer, qwen] = await Promise.all([
      this.asrStatus("vibevoice"),
      this.asrStatus("qwen3-asr-0.6b"),
      this.asrStatus("paraformer-zh"),
      this.qwenOrganizerStatus(),
    ]);
    return {
      vibevoice: { ready: vibevoice.ready, message: vibevoice.message },
      "qwen3-asr-0.6b": { ready: qwen3.ready, message: qwen3.message },
      "paraformer-zh": { ready: paraformer.ready, message: paraformer.message },
      "qwen35-4b": { ready: qwen.ready, message: qwen.message },
    };
  }

  private async asrStatus(modelId: AiAsrModelId): Promise<AiAsrRuntimeStatus> {
    if (modelId === "vibevoice") {
      const vibeHealth = await this.vibeRuntime.health();
      return {
        modelId,
        ready: vibeHealth.ready,
        executable: vibeHealth.executable,
        message: vibeHealth.ready
          ? undefined
          : (vibeHealth.detail ?? "VibeVoice 本地推理运行时尚未就绪。"),
        errorCode: vibeHealth.lastError,
        outputSource: "stdout",
        modelName: "VibeVoice-ASR-BitNet",
        modelVersion: this.models.vibevoice()
          ? path.basename(this.models.vibevoice() as string)
          : undefined,
        modelPath: this.models.vibevoice(),
        runtimePhase: vibeHealth.phase,
        ffmpegPath: resolveFfmpegExecutable(),
        asrInputFormat: "PCM16 WAV / 24000 Hz / mono",
      };
    }

    const worker = this.asrWorker.health();
    const pythonRuntimeExists = await exists(this.pythonExecutable);
    const runnerExists = await exists(this.asrRunner);
    if (modelId === "qwen3-asr-0.6b") {
      const model = this.models.qwen3Asr();
      const pythonRoot = path.dirname(path.dirname(this.pythonExecutable));
      const bundledTransformersReady = await exists(
        path.join(
          pythonRoot,
          "Lib",
          "site-packages",
          "transformers",
          "models",
          "qwen3_asr",
          "__init__.py",
        ),
      );
      const repairedTransformersReady = await exists(
        path.join(this.qwen3AsrPythonPath, "transformers", "models", "qwen3_asr", "__init__.py"),
      );
      const runtimeReady =
        pythonRuntimeExists &&
        runnerExists &&
        (bundledTransformersReady || repairedTransformersReady);
      const modelReady = Boolean(
        model &&
        (await exists(path.join(model, "config.json"))) &&
        (await exists(path.join(model, "model.safetensors"))),
      );
      const ready = modelReady && runtimeReady;
      return {
        modelId,
        ready,
        executable: ready ? this.pythonExecutable : undefined,
        message: !modelReady
          ? "Qwen3-ASR 模型尚未下载完整。"
          : !runtimeReady
            ? "便携 Python 缺少 Qwen3-ASR 运行组件。"
            : worker.modelId === modelId
              ? worker.lastError
              : undefined,
        errorCode: !modelReady ? "model_missing" : !runtimeReady ? "runtime_missing" : undefined,
        outputSource: "stdout",
        modelName: "Qwen3-ASR-0.6B",
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

    const bundle = this.models.paraformer();
    const modelReady = Boolean(
      bundle &&
      (await exists(path.join(bundle, "asr", "model.pt"))) &&
      (await exists(path.join(bundle, "vad", "model.pt"))) &&
      (await exists(path.join(bundle, "punc", "model.pt"))),
    );
    const runtimeReady =
      pythonRuntimeExists &&
      runnerExists &&
      (await exists(path.join(this.funasrPythonPath, "funasr", "__init__.py")));
    const ready = modelReady && runtimeReady;
    return {
      modelId,
      ready,
      executable: ready ? this.pythonExecutable : undefined,
      message: !modelReady
        ? "Paraformer 中文套件尚未下载完整。"
        : !runtimeReady
          ? "FunASR 运行组件尚未安装；点击修复组件后会在后台补齐。"
          : worker.modelId === modelId
            ? worker.lastError
            : undefined,
      errorCode: !modelReady ? "model_missing" : !runtimeReady ? "runtime_missing" : undefined,
      outputSource: "stdout",
      modelName: "Paraformer-zh + FSMN-VAD + CT-punc",
      modelVersion: bundle ? path.basename(bundle) : undefined,
      modelPath: bundle,
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
    const sampleRate = modelId === "vibevoice" ? 24_000 : 16_000;
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
      let segments: VoiceMemoryTranscriptSegment[];
      if (modelId === "vibevoice") {
        const result = await this.vibeRuntime.run({
          wavPath,
          durationMs: options.durationMs,
          signal: options.signal,
          resourceMode: options.resourceMode,
        });
        const rawOutput = result.stdout.replace(/^\uFEFF/, "").trim();
        options.onStage?.("transcript", {
          stdoutBytes: Buffer.byteLength(result.stdout, "utf8"),
          stderrBytes: Buffer.byteLength(result.stderr, "utf8"),
        });
        if (!rawOutput) return [];
        segments = parseVibeVoiceOutput(
          rawOutput,
          options.recordingId,
          options.offsetMs,
          options.durationMs,
        );
      } else {
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
        segments = this.normalizePythonAsrResult(
          result,
          options.recordingId,
          options.offsetMs,
          options.durationMs,
        );
      }
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
    if (id === "qwen3-asr-0.6b") {
      const before = await this.asrStatus(id);
      if (before.ready || before.errorCode === "model_missing") {
        return { ready: before.ready, message: before.message };
      }
      if (!(await exists(this.pythonExecutable))) {
        return { ready: false, message: "便携 Python 尚未安装，无法修复 Qwen3-ASR 运行组件。" };
      }
      await mkdir(this.qwen3AsrPythonPath, { recursive: true });
      try {
        await runLocalProcess(
          this.pythonExecutable,
          [
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-input",
            "--no-warn-script-location",
            "--prefer-binary",
            "--upgrade",
            "--target",
            this.qwen3AsrPythonPath,
            "transformers==5.15.0",
            "accelerate>=1.10,<2",
          ],
          { timeoutMs: 15 * 60_000 },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Qwen3-ASR 运行组件安装失败：${message}`, { cause: error });
      }
      const after = await this.asrStatus(id);
      return { ready: after.ready, message: after.message };
    }
    if (id === "paraformer-zh") {
      const before = await this.asrStatus(id);
      if (before.ready) return { ready: true };
      if (before.errorCode === "model_missing") return { ready: false, message: before.message };
      await mkdir(this.funasrPythonPath, { recursive: true });
      try {
        await runLocalProcess(
          this.pythonExecutable,
          [
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "--no-input",
            "--no-warn-script-location",
            "--prefer-binary",
            "--upgrade",
            "--target",
            this.funasrPythonPath,
            "funasr==1.4.3",
          ],
          { timeoutMs: 15 * 60_000 },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`FunASR 运行组件安装失败：${message}`, { cause: error });
      }
      const after = await this.asrStatus(id);
      return { ready: after.ready, message: after.message };
    }
    if (id === "qwen35-4b") {
      const status = await this.qwenOrganizerStatus();
      return { ready: status.ready, message: status.message };
    }
    const status = await this.asrStatus(id);
    return { ready: status.ready, message: status.message };
  }

  private pythonAsrLaunch(modelId: Exclude<AiAsrModelId, "vibevoice">): AsrWorkerLaunch {
    if (modelId === "qwen3-asr-0.6b") {
      const modelPath = this.models.qwen3Asr();
      if (!modelPath) throw new Error("model_qwen3-asr-0.6b_not_installed");
      return { modelId, modelPath, pythonPath: this.qwen3AsrPythonPath };
    }
    const bundle = this.models.paraformer();
    if (!bundle) throw new Error("model_paraformer-zh_not_installed");
    return {
      modelId,
      modelPath: path.join(bundle, "asr"),
      vadModelPath: path.join(bundle, "vad"),
      puncModelPath: path.join(bundle, "punc"),
      pythonPath: this.funasrPythonPath,
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
    return parseVibeVoiceOutput(result.text, recordingId, offsetMs, durationMs);
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
