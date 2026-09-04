import { createHash } from "node:crypto";
import os from "node:os";

import type {
  AiAsrModelId,
  VoiceMemoryCommonVadResult,
  VoiceMemoryTranscriptionOutputStatus,
  VoiceMemoryTranscriptSegment,
} from "@private-voice/shared";

import { ACTIVE_ARK_ASR_VARIANT } from "./ark-asr-config";

import type { AsrWorkerResult } from "./asr-persistent-worker";
import { runLocalProcess } from "./local-process";

export const parseTranscriptTimestamp = (value: string): number => {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 100_000 ? numeric : numeric * 1_000;
  const parts = value.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0) * 1_000;
};

export const temporaryRecordingName = (recordingId: string): string =>
  createHash("sha256").update(recordingId).digest("hex").slice(0, 20);

export interface PcmAudioActivity {
  peak: number;
  activeFrameRatio: number;
  audible: boolean;
  activeFrames: number;
  totalFrames: number;
}

export interface TranscriptionChunkRuntimeResult {
  segments: VoiceMemoryTranscriptSegment[];
  rawText: string;
  rawOutput?: AsrWorkerResult;
  commonVad: VoiceMemoryCommonVadResult;
  outputStatus: VoiceMemoryTranscriptionOutputStatus;
  anomalyTypes: Array<"repetition_loop" | "abnormal_output">;
  anomalyReasons: string[];
  rawAnomalyAttempts?: Array<{
    outputStatus: "repetition_loop" | "abnormal_output";
    rawText: string;
    rawOutput?: AsrWorkerResult;
    anomalyTypes: Array<"repetition_loop" | "abnormal_output">;
    anomalyReasons: string[];
  }>;
  timing: {
    loadTimeMs?: number;
    conversionTimeMs: number;
    inferenceTimeMs?: number;
    totalTimeMs: number;
  };
  resourceUsage?: {
    device?: string;
    backend?: string;
    quantization?: string;
    dtype?: string;
    gpuMemoryBeforeLoadMb?: number;
    gpuMemoryAfterLoadMb?: number;
    gpuPeakMemoryMb?: number;
    ramPeakMb?: number;
    oomCount?: number;
    workerCrashCount?: number;
  };
}

export const modelPrecision = (
  modelId: AiAsrModelId,
): { device: string; quantization: string; dtype?: string } => ({
  device: modelId === "moss-transcribe-diarize-0.9b-q8_0" ? "auto" : "cuda:0",
  quantization:
    modelId === "ark-asr-3b-q8_0" || modelId === "moss-transcribe-diarize-0.9b-q8_0"
      ? ACTIVE_ARK_ASR_VARIANT.displayQuantization
      : "none",
  dtype:
    modelId === "ark-asr-3b-q8_0" || modelId === "moss-transcribe-diarize-0.9b-q8_0"
      ? "int8"
      : modelId === "fireredasr2-aed"
        ? "float16"
        : [
              "qwen3-asr-1.7b-force",
              "qwen3-asr-0.6b-force",
              "fun-asr-nano-2512",
              "glm-asr-nano-2512",
              "moss-transcribe-diarize-0.9b",
              "cohere-transcribe-2b",
            ].includes(modelId)
          ? "bfloat16"
          : undefined,
});

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
    activeFrames,
    totalFrames,
  };
};

export const gpuMemoryUsedMb = async (): Promise<number | undefined> => {
  try {
    const result = await runLocalProcess(
      "nvidia-smi",
      ["--query-gpu=memory.used", "--format=csv,noheader,nounits"],
      { timeoutMs: 5_000 },
    );
    const values = result.stdout
      .split(/\r?\n/)
      .map((value) => Number.parseFloat(value.trim()))
      .filter(Number.isFinite);
    return values.length ? Math.max(...values) : undefined;
  } catch {
    return undefined;
  }
};

export const benchmarkEnvironmentSnapshot = (diagnostics?: {
  gpuNames: string[];
  totalVramBytes?: number;
  torchCudaVersion?: string;
  torchVersion?: string;
}): {
  gpu?: string;
  gpuTotalVramMb?: number;
  cpu?: string;
  ramMb?: number;
  os?: string;
  cudaVersion?: string;
  pytorchVersion?: string;
} => ({
  gpu: diagnostics?.gpuNames.join(", ") || undefined,
  gpuTotalVramMb: diagnostics?.totalVramBytes
    ? Math.round(diagnostics.totalVramBytes / 1024 / 1024)
    : undefined,
  cpu: os.cpus()[0]?.model,
  ramMb: Math.round(os.totalmem() / 1024 / 1024),
  os: `${os.platform()} ${os.release()} ${os.arch()}`,
  cudaVersion: diagnostics?.torchCudaVersion,
  pytorchVersion: diagnostics?.torchVersion,
});
