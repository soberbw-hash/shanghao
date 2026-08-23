import { readFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

import type { AiAsrModelId, AiModelId } from "@private-voice/shared";

import { AiRuntimeManager } from "../src/main/ai-runtime-manager";

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
      results.push({ modelId, elapsedMs: Date.now() - startedAt, transcript });
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
