/* eslint-disable no-console */

import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { AiModelId } from "@private-voice/shared";

import { AiModelManager } from "../src/main/ai-model-manager";
import { AiRuntimeManager } from "../src/main/ai-runtime-manager";

const MODEL_ID = "moss-transcribe-diarize-0.9b-q8_0" as const;
const AI_ROOT = "C:\\Users\\sober\\AppData\\Local\\ShangHao\\AI";
const MODEL_ROOT = path.join(AI_ROOT, "models");
const RUNTIME_ROOT = path.join(AI_ROOT, "runtimes");
const RECORDING_FILE =
  "C:\\Users\\sober\\Documents\\上号录音\\上号-2026-08-30-语音-03-16-24-13.m4a";

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const main = async (): Promise<void> => {
  await mkdir(RUNTIME_ROOT, { recursive: true });
  await copyFile(
    fileURLToPath(new URL("./asr-runner.py", import.meta.url)),
    path.join(RUNTIME_ROOT, "asr-runner.py"),
  );
  const statePath = path.join(MODEL_ROOT, "state.json");
  const modelPath = async (id: AiModelId): Promise<string | undefined> => {
    const state = JSON.parse(await readFile(statePath, "utf8").catch(() => '{"models":{}}')) as {
      models?: Partial<Record<AiModelId, { activeRevision?: string }>>;
    };
    const revision = state.models?.[id]?.activeRevision;
    return revision ? path.join(MODEL_ROOT, id, revision) : undefined;
  };
  let resolvedModelPath = await modelPath(MODEL_ID);
  const runtime = new AiRuntimeManager(RUNTIME_ROOT, {
    model: (id) => (id === MODEL_ID ? resolvedModelPath : undefined),
    qwen: () => undefined,
    activeAsr: () => MODEL_ID,
  });
  const gameDetection = {
    getSnapshot: () => ({ gameName: undefined }),
    onDetected: () => () => undefined,
  };
  const manager = new AiModelManager(MODEL_ROOT, gameDetection as never, async (payload) => {
    if (payload.level === "warn" || payload.level === "error") {
      process.stderr.write(`${JSON.stringify(payload)}\n`);
    }
  });
  await manager.initialize("manual", MODEL_ID);
  manager.setRuntimePreparer(async (id) => {
    resolvedModelPath = await modelPath(id);
    const prepared = await runtime.prepareModelRuntime(id);
    const statuses = await runtime.modelRuntimeStatuses();
    manager.setRuntimeStatuses(statuses);
    return statuses[id] ?? prepared;
  });
  try {
    const initial = manager.getSnapshot().models.find((model) => model.id === MODEL_ID);
    if (!initial?.userInstalled || !initial.activeRevision) {
      await manager.controlModel(MODEL_ID, initial?.phase === "paused" ? "resume" : "download");
      for (;;) {
        const status = manager.getSnapshot().models.find((model) => model.id === MODEL_ID);
        process.stdout.write(
          `${JSON.stringify({ phase: status?.phase, progress: status?.progress, downloadedBytes: status?.downloadedBytes, totalBytes: status?.totalBytes, error: status?.errorMessage })}\n`,
        );
        if (status?.phase === "installed") break;
        if (status?.phase === "error")
          throw new Error(status.errorMessage ?? "model_download_failed");
        await wait(2_000);
      }
    }
    resolvedModelPath = await modelPath(MODEL_ID);
    if (!resolvedModelPath) throw new Error("moss_q8_model_path_missing");
    const prepared = await runtime.prepareModelRuntime(MODEL_ID);
    if (!prepared.ready) throw new Error(prepared.message ?? "moss_q8_runtime_not_ready");
    const startedAt = Date.now();
    const result = await runtime.transcribeChunk({
      modelId: MODEL_ID,
      recordingId: "moss-q8-three-minute-smoke",
      filePath: RECORDING_FILE,
      offsetMs: 8 * 60_000,
      durationMs: 3 * 60_000,
      benchmark: true,
      resourceMode: "normal",
    });
    process.stdout.write(
      `${JSON.stringify({
        ok: result.outputStatus === "normal" && result.segments.length > 0,
        elapsedMs: Date.now() - startedAt,
        outputStatus: result.outputStatus,
        segmentCount: result.segments.length,
        speakerIds: [...new Set(result.segments.map((segment) => segment.speakerId))],
        firstSegments: result.segments.slice(0, 6),
        timing: result.timing,
        resourceUsage: result.resourceUsage,
        nativeMetrics: result.rawOutput?.metrics,
        nativeSpeakerSegments: result.rawOutput?.nativeSpeakerSegments?.slice(0, 12),
      })}\n`,
    );
    if (result.outputStatus !== "normal" || result.segments.length === 0) {
      throw new Error("moss_q8_smoke_produced_no_valid_speech");
    }
  } finally {
    runtime.stop();
    manager.stop();
  }
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
