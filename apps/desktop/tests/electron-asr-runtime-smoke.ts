import { mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import { app } from "electron";

import type { AiAsrModelId, AiModelId } from "@private-voice/shared";

import { AiRuntimeManager } from "../src/main/ai-runtime-manager";
import { resolveFfmpegExecutable } from "../src/main/media-runtime";
import { runLocalProcess } from "../src/main/local-process";

require(path.resolve("tests/electron-isolated-profile.cjs")).configureIsolatedProfile(
  app,
  "asr-runtime",
);

interface ModelStateFile {
  models: Partial<
    Record<AiModelId, { activeRevision?: string; phase?: string; downloadedBytes?: number }>
  >;
}

const requestedModels = (): AiAsrModelId[] => {
  const ids = (process.env.SHANGHAO_ASR_SMOKE_MODELS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean) as AiAsrModelId[];
  if (!ids.length) throw new Error("SHANGHAO_ASR_SMOKE_MODELS_required");
  return ids;
};

const run = async (): Promise<void> => {
  await app.whenReady();
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error("LOCALAPPDATA_unavailable");
  const aiRoot = path.join(localAppData, "ShangHao", "AI");
  const modelsRoot = path.join(aiRoot, "models");
  const state = JSON.parse(
    await readFile(path.join(modelsRoot, "state.json"), "utf8"),
  ) as ModelStateFile;
  const modelPath = (id: AiModelId): string | undefined => {
    const revision = state.models[id]?.activeRevision;
    return revision ? path.join(modelsRoot, id, revision) : undefined;
  };
  const runtime = new AiRuntimeManager(path.join(aiRoot, "runtimes"), {
    model: modelPath,
    qwen: () => undefined,
    activeAsr: () => "qwen3-asr-0.6b-force",
  });
  const samplePath = path.join(
    process.cwd(),
    "src",
    "renderer",
    "src",
    "assets",
    "sounds",
    "animals",
    "quick-reply-shanghao.wav",
  );
  try {
    const cuda = await runtime.initializeCudaRuntime();
    if (!cuda.cudaAvailable || !cuda.bf16Supported) throw new Error("cuda_runtime_not_ready");
    const results = [];
    for (const modelId of requestedModels()) {
      const prepared = await runtime.prepareModelRuntime(modelId);
      if (!prepared.ready) throw new Error(`${modelId}:${prepared.message ?? "runtime_not_ready"}`);
      const startedAt = Date.now();
      const transcript = await runtime.transcribeChunk({
        modelId,
        recordingId: `smoke-${modelId}`,
        filePath: samplePath,
        offsetMs: 0,
        durationMs: 5_000,
        resourceMode: "normal",
      });
      if (
        transcript.outputStatus !== "normal" ||
        !transcript.segments.some((segment) => segment.text.trim().length > 0)
      ) {
        throw new Error(
          `${modelId}:smoke_transcription_rejected:${transcript.outputStatus}:segments=${transcript.segments.length}`,
        );
      }
      results.push({
        modelId,
        elapsedMs: Date.now() - startedAt,
        outputStatus: transcript.outputStatus,
        segmentCount: transcript.segments.length,
        timing: transcript.timing,
        resourceUsage: transcript.resourceUsage,
      });
      if (process.env.SHANGHAO_ASR_SMOKE_VERIFY_ALIGNMENT === "1") {
        const sourceHash = createHash("sha256")
          .update(await readFile(samplePath))
          .digest("hex");
        const directory = path.join(app.getPath("userData"), "alignment-proof");
        await mkdir(directory, { recursive: true });
        const paddedPath = path.join(directory, "three-second-offset.wav");
        const ffmpeg = resolveFfmpegExecutable();
        if (!ffmpeg) throw Error("ffmpeg_runtime_unavailable");
        await runLocalProcess(
          ffmpeg,
          [
            "-nostdin",
            "-y",
            "-i",
            samplePath,
            "-af",
            "adelay=3000:all=1",
            "-c:a",
            "pcm_s16le",
            paddedPath,
          ],
          { timeoutMs: 15_000 },
        );
        const warmStartedAt = Date.now();
        const shifted = await runtime.transcribeChunk({
          modelId,
          recordingId: `shifted-${modelId}`,
          filePath: paddedPath,
          offsetMs: 3_000,
          durationMs: 5_000,
          resourceMode: "normal",
        });
        const text = (segments: typeof transcript.segments) =>
          segments
            .map((s) => s.text)
            .join("")
            .replace(/[\p{P}\p{Z}\s]/gu, "");
        const first = transcript.segments[0]!;
        const second = shifted.segments[0];
        if (
          shifted.outputStatus !== "normal" ||
          !second ||
          text(shifted.segments) !== text(transcript.segments) ||
          Math.abs(second.startMs - first.startMs - 3000) > 200 ||
          Math.abs(second.endMs - first.endMs - 3000) > 200 ||
          shifted.segments.some(
            (s) => s.startMs < 3000 || s.endMs > 8000 || s.endMs <= s.startMs,
          ) ||
          createHash("sha256")
            .update(await readFile(samplePath))
            .digest("hex") !== sourceHash
        )
          throw Error("native_alignment_or_source_integrity_failed");
        results.push({
          modelId,
          warmElapsedMs: Date.now() - warmStartedAt,
          alignmentOffsetMs: second.startMs - first.startMs,
          wordCount: shifted.segments.reduce((sum, s) => sum + (s.words?.length ?? 0), 0),
          sourceUnchanged: true,
        });
      }
    }
    console.log(
      JSON.stringify({
        ok: true,
        pythonPath: cuda.pythonPath,
        torchVersion: cuda.torchVersion,
        torchCudaVersion: cuda.torchCudaVersion,
        gpuNames: cuda.gpuNames,
        bf16Supported: cuda.bf16Supported,
        results,
      }),
    );
  } finally {
    runtime.stop();
    app.quit();
  }
};

void run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  app.exit(1);
});
