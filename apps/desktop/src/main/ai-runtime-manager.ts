import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";

import {
  isReliableTranscriptText,
  type AiRuntimeStatus,
  type VoiceMemoryTranscriptSegment,
} from "@private-voice/shared";

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

const runProcess = async (
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    timeoutMs: number;
    input?: string;
  },
): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error("ai_task_paused"));
    const child: ChildProcessWithoutNullStreams = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let terminationReason: "paused" | "timeout" | undefined;
    let terminationFallback: NodeJS.Timeout | undefined;
    const terminate = (reason: "paused" | "timeout") => {
      if (terminationReason) return;
      terminationReason = reason;
      if (process.platform === "win32" && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.unref();
      } else {
        child.kill("SIGKILL");
      }
      terminationFallback = setTimeout(() => {
        options.signal?.removeEventListener("abort", abort);
        reject(new Error(reason === "paused" ? "ai_task_paused" : "ai_runtime_timeout"));
      }, 3_000);
    };
    const timeout = setTimeout(() => terminate("timeout"), options.timeoutMs);
    const abort = () => terminate("paused");
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value: string) => (stdout += value));
    child.stderr.on("data", (value: string) => (stderr += value));
    child.stdin.end(options.input ?? "");
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (terminationFallback) clearTimeout(terminationFallback);
      options.signal?.removeEventListener("abort", abort);
      if (terminationReason === "paused" || options.signal?.aborted)
        return reject(new Error("ai_task_paused"));
      if (terminationReason === "timeout") return reject(new Error("ai_runtime_timeout"));
      if (code !== 0) return reject(new Error(`ai_runtime_exit_${code}: ${stderr.slice(-500)}`));
      resolve({ stdout, stderr });
    });
  });

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
  // Local model output is parsed one line at a time, so the input is bounded.
  // eslint-disable-next-line security/detect-unsafe-regex
  const pattern = /^\[([^\]]+)\s+-\s+([^\]]+)\]\s+(?:Speaker\s+([^:]+):\s*)?(.+)$/gm;
  const segments: VoiceMemoryTranscriptSegment[] = [];
  let sawTimestampOutput = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output))) {
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
  const plain = output
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

  constructor(
    private readonly runtimeRoot: string,
    private readonly models: RuntimeModelPaths,
  ) {
    this.pythonExecutable = path.join(runtimeRoot, "python", "Scripts", "python.exe");
    this.qwenRunner = path.join(runtimeRoot, "qwen-runner.py");
    this.vibeExecutable = path.join(runtimeRoot, "VibeASR.cpp", "build", "bin", "asr_infer.exe");
    this.mingwBin = path.join(runtimeRoot, "mingw64", "bin");
  }

  async status(): Promise<AiRuntimeStatus> {
    const vibevoice = this.models.vibevoice();
    const qwen = this.models.qwen();
    const vibeReady = Boolean(
      vibevoice &&
      (await exists(this.vibeExecutable)) &&
      (await exists(path.join(vibevoice, "vibeasr-vae-encoder-i8_s.gguf"))) &&
      (await exists(path.join(vibevoice, "vibeasr-lm-i2_s-embed-q6_k.gguf"))),
    );
    const qwenReady = Boolean(
      qwen &&
      (await exists(this.pythonExecutable)) &&
      (await exists(this.qwenRunner)) &&
      (await exists(path.join(qwen, "config.json"))),
    );
    return {
      vibevoice: {
        ready: vibeReady,
        executable: vibeReady ? this.vibeExecutable : undefined,
        message: vibeReady ? undefined : "VibeVoice 本地推理运行时尚未就绪。",
      },
      qwen: {
        ready: qwenReady,
        executable: qwenReady ? this.pythonExecutable : undefined,
        message: qwenReady ? undefined : "Qwen 本地推理运行时尚未就绪。",
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
    const vibevoice = this.models.vibevoice();
    if (!vibevoice) throw new Error("model_vibevoice_not_installed");
    if (!ffmpegPath) throw new Error("ffmpeg_runtime_unavailable");
    const status = await this.status();
    if (!status.vibevoice.ready) throw new Error("vibevoice_runtime_unavailable");
    const temporaryDirectory = await mkdir(path.join(os.tmpdir(), "shanghao-voice-memory"), {
      recursive: true,
    }).then(() => path.join(os.tmpdir(), "shanghao-voice-memory"));
    const wavPath = path.join(
      temporaryDirectory,
      `${temporaryRecordingName(options.recordingId)}-${options.offsetMs}-${process.pid}.wav`,
    );
    await runProcess(
      ffmpegPath,
      [
        "-y",
        "-ss",
        String(options.offsetMs / 1_000),
        "-t",
        String(options.durationMs / 1_000),
        "-i",
        options.filePath,
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
    try {
      const activity = analyzePcm16Wav(await readFile(wavPath));
      if (!activity.audible) return [];
      const result = await runProcess(
        this.vibeExecutable,
        [
          "--vae-model",
          path.join(vibevoice, "vibeasr-vae-encoder-i8_s.gguf"),
          "--lm-model",
          path.join(vibevoice, "vibeasr-lm-i2_s-embed-q6_k.gguf"),
          "--audio",
          wavPath,
          "-c",
          "4096",
          "-b",
          "2048",
          "--max-tokens",
          "1024",
          "-t",
          String(
            options.resourceMode === "low" ? 2 : Math.max(2, Math.min(6, os.cpus().length - 2)),
          ),
          "--greedy",
          "--context",
          // Keep argv ASCII-only: the native MinGW runtime parses Windows arguments with the
          // active code page and rejects direct CJK context text before inference starts.
          "Mandarin Chinese voice chat; prefer Simplified Chinese; preserve spoken English, game names, people names and software names.",
          "--prompt-format",
          // The installed BitNet runtime is the 1.5B model. Its official output mode is text;
          // the JSON prompt targets the 7B model and can collapse into repeated phrases.
          "text",
        ],
        {
          signal: options.signal,
          timeoutMs: Math.max(180_000, options.durationMs * 5),
          env: { ...process.env, PATH: `${this.mingwBin};${process.env.PATH ?? ""}` },
        },
      );
      return parseVibeVoiceOutput(
        result.stdout,
        options.recordingId,
        options.offsetMs,
        options.durationMs,
      );
    } finally {
      await rm(wavPath, { force: true }).catch(() => undefined);
    }
  }

  async generateJson<T>(options: QwenGenerateOptions): Promise<T> {
    const qwen = this.models.qwen();
    if (!qwen) throw new Error("model_qwen35-4b_not_installed");
    const status = await this.status();
    if (!status.qwen.ready) throw new Error("qwen_runtime_unavailable");
    const result = await runProcess(
      this.pythonExecutable,
      [
        this.qwenRunner,
        "--model",
        qwen,
        "--max-new-tokens",
        String(options.maxNewTokens ?? 1_024),
        "--resource-mode",
        options.resourceMode,
      ],
      {
        signal: options.signal,
        timeoutMs: 2 * 60_000,
        input: options.prompt,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
      },
    );
    const trimmed = result.stdout.trim();
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
