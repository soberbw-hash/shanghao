/* eslint-disable no-console */

import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AiTaskCheckpoint, VoiceMemoryRecord } from "@private-voice/shared";

import { AiRuntimeManager } from "../src/main/ai-runtime-manager";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";

const RECORDING_ROOT = "C:\\Users\\sober\\Documents\\上号录音";
const RUNTIME_ROOT = "C:\\Users\\sober\\AppData\\Local\\ShangHao\\AI\\runtimes";
const MODEL_ROOT =
  "C:\\Users\\sober\\AppData\\Local\\ShangHao\\AI\\models\\dolphin-cn-dialect-0.4b";
const MODEL_ID = "dolphin-cn-dialect-0.4b" as const;

const checkpoints = new Map<string, AiTaskCheckpoint>();
const modelEvents = new Set<() => void>();
const models = {
  getActiveAsrModel: () => MODEL_ID,
  canRunTask: () => ({ runnable: true, requiredModel: MODEL_ID }),
  getTaskCheckpoint: (taskId: string) => checkpoints.get(taskId),
  saveTaskCheckpoint: async (checkpoint: AiTaskCheckpoint) => {
    checkpoints.set(checkpoint.taskId, checkpoint);
  },
  clearTaskCheckpoint: async (taskId: string) => {
    checkpoints.delete(taskId);
  },
  onStatus: (listener: () => void) => {
    modelEvents.add(listener);
    return () => modelEvents.delete(listener);
  },
  setRuntimeStatus: () => undefined,
  setRuntimeStatuses: () => undefined,
};

const textGateway = {
  usesLocalOrganizer: () => false,
  generateJson: async () => {
    throw new Error("organizer_disabled_in_asr_verification");
  },
  generateJsonWithMetrics: async () => {
    throw new Error("organizer_disabled_in_asr_verification");
  },
};

const summarize = (record: VoiceMemoryRecord) => ({
  recordingId: record.recordingId,
  phase: record.phase,
  taskStatus: record.taskStatus,
  taskProgressPercent: record.transcriptionStats?.taskProgressPercent,
  completedUnits: record.transcriptionStats?.completedUnits,
  totalUnits: record.transcriptionStats?.totalUnits,
  failedUnits: record.transcriptionStats?.failedUnits,
  retryCount: record.transcriptionStats?.retryCount,
  transcriptSegments: record.transcript.length,
  elapsedMs: record.transcriptionElapsedMs,
  error: record.errorMessage ?? record.diagnostic?.errorMessage,
});

const main = async () => {
  const revisions = await readdir(MODEL_ROOT, { withFileTypes: true });
  const revision = revisions.find((entry) => entry.isDirectory())?.name;
  if (!revision) throw new Error("dolphin_model_revision_missing");
  const candidates = (await readdir(RECORDING_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase().endsWith(".m4a"))
    .map((entry) => path.join(RECORDING_ROOT, entry.name))
    .filter((filePath) =>
      [
        "上号-2026-08-30-语音-03-16-24-13.m4a",
        "上号-2026-08-29-语音-01-18-25-14.m4a",
        "上号-2026-08-23-语音-04-23-16-10.m4a",
      ].includes(path.basename(filePath)),
    );
  if (candidates.length < 3) throw new Error("verification_recordings_missing");

  const scratch = await mkdtemp(path.join(os.tmpdir(), "shanghao-dolphin-10m-"));
  const runtime = new AiRuntimeManager(RUNTIME_ROOT, {
    model: (id) => (id === MODEL_ID ? path.join(MODEL_ROOT, revision) : undefined),
    qwen: () => undefined,
    activeAsr: () => MODEL_ID,
  });
  const service = new AiVoiceMemoryService(
    models as never,
    runtime,
    textGateway as never,
    new VoiceMemoryStore(path.join(scratch, "voice-memory")),
    async (payload) => {
      if (payload.level === "error" || payload.level === "warn") {
        console.error(JSON.stringify(payload));
      }
    },
    () => false,
  );

  const lastProgress = new Map<string, number>();
  service.onStatus((record) => {
    const progress = Math.floor(record.transcriptionStats?.taskProgressPercent ?? 0);
    if (lastProgress.get(record.recordingId) === progress) return;
    lastProgress.set(record.recordingId, progress);
    console.log(
      JSON.stringify({
        event: "progress",
        recordingId: record.recordingId,
        phase: record.phase,
        progress,
        completedUnits: record.transcriptionStats?.completedUnits,
        totalUnits: record.transcriptionStats?.totalUnits,
      }),
    );
  });

  const results: ReturnType<typeof summarize>[] = [];
  try {
    await service.initialize();
    const runtimeStatus = await runtime.prepareModelRuntime(MODEL_ID);
    if (!runtimeStatus.ready) throw new Error(runtimeStatus.message ?? "dolphin_runtime_not_ready");
    for (const [index, filePath] of candidates.entries()) {
      const recordingId = `dolphin-10m-${index + 1}`;
      const result = await service.process({
        recordingId,
        filePath,
        roomId: "main",
        roomName: "一号房",
        manual: true,
        transcribe: true,
        organize: false,
        restartTranscription: true,
        asrModelId: MODEL_ID,
        taskId: `verification:${recordingId}`,
        benchmark: { mode: "standard" },
      });
      const summary = summarize(result);
      results.push(summary);
      console.log(JSON.stringify({ event: "result", filePath, ...summary }));
    }
  } finally {
    runtime.stop();
    await rm(scratch, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ event: "complete", results }, null, 2));
  if (
    results.some(
      (result) =>
        result.phase !== "ready" ||
        result.taskStatus !== "success" ||
        result.taskProgressPercent !== 100 ||
        result.failedUnits !== 0,
    )
  ) {
    process.exitCode = 1;
  }
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
