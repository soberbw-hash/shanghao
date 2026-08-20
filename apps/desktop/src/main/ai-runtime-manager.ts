import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";

import {
  isReliableTranscriptText,
  type AiRuntimeStatus,
  type VoiceMemoryTranscriptSegment,
} from "@private-voice/shared";

import {
  classifyLocalModelRuntimeError,
  LocalModelRuntimeError,
  type LocalModelRuntimeHealth,
} from "./local-model-runtime";
import { QwenRuntime } from "./qwen-runtime";
import type { QwenWorkerHealth } from "./qwen-persistent-worker";
import { runLocalProcess } from "./local-process";
import { VibeVoiceRuntime } from "./vibevoice-runtime";

interface RuntimeModelPaths {
  vibevoice: () => string | undefined;
  qwen: () => string | undefined;
}

interface QwenGenerateOptions {
  prompt: string;
  maxNewTokens?: number;
  resourceMode: "low" | "normal";
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
          if (!text || !isReliableTranscriptText(text, endMs - startMs)) return [];
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
    if (!isReliableTranscriptText(text, endMs - startMs)) continue;
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
  if (
    !sawTimestampOutput &&
    !segments.length &&
    plain &&
    isReliableTranscriptText(plain, durationMs)
  ) {
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
  private readonly vibeExecutable: string;
  private readonly mingwBin: string;
  private readonly qwenWorker: QwenRuntime;
  private readonly vibeRuntime: VibeVoiceRuntime;

  constructor(
    private readonly runtimeRoot: string,
    private readonly models: RuntimeModelPaths,
  ) {
    const compactPython = path.join(runtimeRoot, "qwen", "python", "Scripts", "python.exe");
    this.pythonExecutable = existsSync(compactPython)
      ? compactPython
      : path.join(runtimeRoot, "python", "Scripts", "python.exe");
    this.qwenRunner = path.join(runtimeRoot, "qwen-runner.py");
    const compactVibe = path.join(runtimeRoot, "vibevoice", "asr_infer.exe");
    this.vibeExecutable = existsSync(compactVibe)
      ? compactVibe
      : path.join(runtimeRoot, "VibeASR.cpp", "build", "bin", "asr_infer.exe");
    this.mingwBin = existsSync(compactVibe)
      ? path.dirname(compactVibe)
      : path.join(runtimeRoot, "mingw64", "bin");
    this.vibeRuntime = new VibeVoiceRuntime(
      this.vibeExecutable,
      this.mingwBin,
      this.models.vibevoice,
    );
    this.qwenWorker = new QwenRuntime(this.pythonExecutable, this.qwenRunner, this.models.qwen);
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
  }

  async runtimeHealth(): Promise<LocalModelRuntimeHealth[]> {
    const status = await this.status();
    const vibe = await this.vibeRuntime.health();
    const qwen = this.qwenWorker.workerHealth();
    return [
      {
        id: "vibevoice",
        phase: vibe.phase,
        ready: status.vibevoice.ready,
        loaded: vibe.loaded,
        executable: status.vibevoice.executable,
        queuedJobs: 0,
        activeJobId: vibe.activeJobId,
        lastError: vibe.lastError,
        detail: status.vibevoice.message,
      },
      {
        id: "qwen35-4b",
        phase: status.qwen.ready
          ? qwen.phase === "crashed"
            ? "error"
            : qwen.phase === "starting"
              ? "preparing"
              : qwen.phase
          : "missing",
        ready: status.qwen.ready,
        loaded: qwen.loaded,
        executable: status.qwen.executable,
        processId: qwen.processId,
        queuedJobs: qwen.queuedJobs,
        activeJobId: qwen.activeJobId,
        lastError: qwen.lastError ? classifyLocalModelRuntimeError(qwen.lastError) : undefined,
        detail: qwen.lastError ?? status.qwen.message,
      },
    ];
  }

  async status(): Promise<AiRuntimeStatus> {
    const qwen = this.models.qwen();
    const vibeHealth = await this.vibeRuntime.health();
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
      vibevoice: {
        ready: vibeHealth.ready,
        executable: vibeHealth.executable,
        message: vibeHealth.ready
          ? undefined
          : (vibeHealth.detail ?? "VibeVoice 本地推理运行时尚未就绪。"),
        errorCode: vibeHealth.lastError,
        // The pinned microsoft/VibeASR.cpp asr_infer target writes the transcript to stdout;
        // stderr contains timing/diagnostics and it has no output-file argument.
        outputSource: "stdout",
      },
      qwen: {
        ready: qwenReady,
        executable: qwenReady ? this.pythonExecutable : undefined,
        message: qwenReady ? undefined : "Qwen 本地推理运行时尚未就绪。",
        errorCode: qwenErrorCode,
        workerPhase: qwenWorker.phase,
        loaded: qwenWorker.loaded,
        processId: qwenWorker.processId,
        queuedJobs: qwenWorker.queuedJobs,
        lastError: qwenWorker.lastError,
      },
    };
  }

  async transcribeChunk(options: {
    recordingId: string;
    filePath: string;
    offsetMs: number;
    durationMs: number;
    signal?: AbortSignal;
    resourceMode: "low" | "normal";
  }): Promise<VoiceMemoryTranscriptSegment[]> {
    if (!ffmpegPath) throw new Error("ffmpeg_runtime_unavailable");
    await this.validateInputFile(options.filePath);
    const status = await this.status();
    if (!status.vibevoice.ready) throw new Error("vibevoice_runtime_unavailable");
    const temporaryDirectory = await mkdir(path.join(os.tmpdir(), "shanghao-voice-memory"), {
      recursive: true,
    }).then(() => path.join(os.tmpdir(), "shanghao-voice-memory"));
    const wavPath = path.join(
      temporaryDirectory,
      `${temporaryRecordingName(options.recordingId)}-${options.offsetMs}-${process.pid}.wav`,
    );
    try {
      try {
        await runLocalProcess(
          ffmpegPath,
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
            "24000",
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
      const activity = analyzePcm16Wav(await readFile(wavPath));
      if (!activity.audible) return [];
      const result = await this.vibeRuntime.run({
        wavPath,
        durationMs: options.durationMs,
        signal: options.signal,
        resourceMode: options.resourceMode,
      });
      const rawOutput = result.stdout.replace(/^\uFEFF/, "").trim();
      // The native process already throws on a non-zero exit. A successful inference with no
      // stdout means this audible unit did not contain speech the model could recognize. Empty
      // conversational gaps are expected and must not fail a long recording after earlier units
      // were durably transcribed.
      if (!rawOutput) return [];
      const segments = parseVibeVoiceOutput(
        rawOutput,
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

  async generateJson<T>(options: QwenGenerateOptions): Promise<T> {
    const qwen = this.models.qwen();
    if (!qwen) throw new Error("model_qwen35-4b_not_installed");
    const status = await this.status();
    if (!status.qwen.ready) throw new Error("qwen_runtime_unavailable");
    const output = await this.qwenWorker.run({
      prompt: options.prompt,
      maxNewTokens: options.maxNewTokens ?? 1_024,
      resourceMode: options.resourceMode,
      timeoutMs: 2 * 60_000,
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
