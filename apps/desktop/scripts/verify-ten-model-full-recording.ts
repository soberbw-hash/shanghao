import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AI_ASR_MODEL_NAMES,
  type AiAsrModelId,
  type VoiceMemoryRecord,
  type VoiceMemoryTranscriptionVariant,
} from "@private-voice/shared";

import { AiModelManager } from "../src/main/ai-model-manager";
import { AiRuntimeManager } from "../src/main/ai-runtime-manager";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";

const RECORDING_ID = "71140c19-40da-4a72-a3df-41e3bc5276ff";
const RECORDING_FILE =
  "C:\\Users\\sober\\Documents\\上号录音\\上号-2026-08-30-语音-03-16-24-13.m4a";
const USER_DATA = "C:\\Users\\sober\\AppData\\Roaming\\shanghao-desktop";
const VOICE_MEMORY_ROOT = path.join(USER_DATA, "voice-memory");
const MODEL_ROOT = "C:\\Users\\sober\\AppData\\Local\\ShangHao\\AI\\models";
const RUNTIME_ROOT = "C:\\Users\\sober\\AppData\\Local\\ShangHao\\AI\\runtimes";
const RUN_DIRECTORY = path.join(VOICE_MEMORY_ROOT, "verification", RECORDING_ID);
const RUN_STATE_FILE = path.join(RUN_DIRECTORY, "ten-model-full-run.json");

const MODEL_ORDER: AiAsrModelId[] = [
  "paraformer-zh",
  "fun-asr-nano-2512",
  "dolphin-cn-dialect-0.4b",
  "glm-asr-nano-2512",
  "fireredasr2-aed",
  "moss-transcribe-diarize-0.9b",
  "cohere-transcribe-2b",
  "ark-asr-3b-q8_0",
  "qwen3-asr-0.6b-force",
  "qwen3-asr-1.7b-force",
];

interface VerificationState {
  recordingId: string;
  startedAt: string;
  updatedAt: string;
  resetCompleted: boolean;
  completedModels: AiAsrModelId[];
  currentModel?: AiAsrModelId;
  backupDirectory?: string;
}

const emit = (event: string, payload: Record<string, unknown> = {}): void => {
  process.stdout.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...payload })}\n`);
};

const readJson = async <T>(filePath: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
};

const writeRunState = async (state: VerificationState): Promise<void> => {
  await mkdir(RUN_DIRECTORY, { recursive: true });
  state.updatedAt = new Date().toISOString();
  await writeFile(RUN_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
};

const firstRevisionDirectory = async (modelId: string): Promise<string | undefined> => {
  const modelDirectory = path.join(MODEL_ROOT, modelId);
  const entries = await readdir(modelDirectory, { withFileTypes: true }).catch(() => []);
  const revision = entries.find((entry) => entry.isDirectory());
  return revision ? path.join(modelDirectory, revision.name) : undefined;
};

const variantCompleted = (variant: VoiceMemoryTranscriptionVariant | undefined): boolean =>
  Boolean(
    variant?.transcriptionStats?.taskProgressPercent === 100 &&
    variant.transcriptionStats.finalResultSaved === true &&
    (variant.transcriptionStats.failedUnits ?? 0) === 0 &&
    variant.transcriptionUnits?.every((unit) => unit.status === "completed"),
  );

const summarizeVariant = (variant: VoiceMemoryTranscriptionVariant | undefined) => ({
  progress: variant?.transcriptionStats?.taskProgressPercent,
  completedUnits: variant?.transcriptionStats?.completedUnits,
  totalUnits: variant?.transcriptionStats?.totalUnits,
  failedUnits: variant?.transcriptionStats?.failedUnits,
  segments: variant?.transcript.length,
  elapsedMs: variant?.transcriptionElapsedMs,
  gpuPeakMemoryMb: variant?.transcriptionStats?.resourceUsage?.gpuPeakMemoryMb,
  gpuMemoryAfterReleaseMb: variant?.transcriptionStats?.resourceUsage?.gpuMemoryAfterReleaseMb,
  possibleResourceLeak: variant?.transcriptionStats?.resourceUsage?.possibleResourceLeak,
  oomCount: variant?.transcriptionStats?.resourceUsage?.oomCount,
  workerCrashCount: variant?.transcriptionStats?.resourceUsage?.workerCrashCount,
});

const backupDurableState = async (): Promise<string> => {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const backupDirectory = path.join(RUN_DIRECTORY, "backups", stamp);
  await mkdir(backupDirectory, { recursive: true });
  await copyFile(
    path.join(VOICE_MEMORY_ROOT, "records", `${RECORDING_ID}.json`),
    path.join(backupDirectory, `${RECORDING_ID}.json`),
  );
  await copyFile(path.join(MODEL_ROOT, "state.json"), path.join(backupDirectory, "state.json"));
  return backupDirectory;
};

const main = async (): Promise<void> => {
  const modelDirectories = new Map<string, string>();
  for (const modelId of [...MODEL_ORDER, "qwen3-forced-aligner-0.6b" as const]) {
    const directory = await firstRevisionDirectory(modelId);
    if (!directory) throw new Error(`model_revision_missing:${modelId}`);
    modelDirectories.set(modelId, directory);
  }

  await copyFile(
    fileURLToPath(new URL("./asr-runner.py", import.meta.url)),
    path.join(RUNTIME_ROOT, "asr-runner.py"),
  );

  const gameDetection = {
    getSnapshot: () => ({ gameName: undefined }),
    onDetected: () => () => undefined,
  };
  const models = new AiModelManager(MODEL_ROOT, gameDetection as never, async (payload) => {
    if (payload.level === "error" || payload.level === "warn") {
      emit("model_manager_log", {
        level: payload.level,
        message: payload.message,
        context: payload.context,
      });
    }
  });
  await models.initialize("manual", MODEL_ORDER[0]);

  let activeModel = MODEL_ORDER[0];
  const runtime = new AiRuntimeManager(
    RUNTIME_ROOT,
    {
      model: (id) => modelDirectories.get(id),
      qwen: () => undefined,
      activeAsr: () => activeModel,
    },
    {
      writeLog: async (payload) => {
        if (payload.level === "error" || payload.level === "warn") {
          emit("runtime_log", {
            level: payload.level,
            message: payload.message,
            context: payload.context,
          });
        }
      },
    },
  );
  const textGateway = {
    usesLocalOrganizer: () => false,
    generateJson: async () => {
      throw new Error("organizer_disabled_in_asr_verification");
    },
    generateJsonWithMetrics: async () => {
      throw new Error("organizer_disabled_in_asr_verification");
    },
  };
  const store = new VoiceMemoryStore(VOICE_MEMORY_ROOT);
  const service = new AiVoiceMemoryService(
    models,
    runtime,
    textGateway as never,
    store,
    async (payload) => {
      if (payload.level === "error" || payload.level === "warn") {
        emit("voice_memory_log", {
          level: payload.level,
          message: payload.message,
          context: payload.context,
        });
      }
    },
    () => false,
  );

  let interrupted = false;
  const interrupt = (): void => {
    if (interrupted) return;
    interrupted = true;
    emit("interrupt_requested", { activeModel });
    service.pause(RECORDING_ID);
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);

  const lastProgress = new Map<AiAsrModelId, number>();
  service.onStatus((record) => {
    const modelId = record.transcriptionModel?.id;
    if (!modelId || modelId !== activeModel) return;
    const progress = Math.floor(record.transcriptionStats?.taskProgressPercent ?? 0);
    if (lastProgress.get(modelId) === progress) return;
    lastProgress.set(modelId, progress);
    emit("progress", {
      modelId,
      progress,
      completedUnits: record.transcriptionStats?.completedUnits,
      totalUnits: record.transcriptionStats?.totalUnits,
      failedUnits: record.transcriptionStats?.failedUnits,
      stage: record.processingStage,
    });
  });

  let state =
    (await readJson<VerificationState>(RUN_STATE_FILE)) ??
    ({
      recordingId: RECORDING_ID,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      resetCompleted: false,
      completedModels: [],
    } satisfies VerificationState);

  try {
    await service.initialize();
    if (process.env.SHANGHAO_VERIFY_RESET === "1" || !state.resetCompleted) {
      const backupDirectory = await backupDurableState();
      await service.clearTranscriptionResults(RECORDING_ID);
      state = {
        recordingId: RECORDING_ID,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        resetCompleted: true,
        completedModels: [],
        backupDirectory,
      };
      await writeRunState(state);
      emit("durable_results_cleared", { backupDirectory });
    }

    for (const modelId of MODEL_ORDER) {
      if (interrupted) break;
      activeModel = modelId;
      models.setActiveAsrModel(modelId);
      const before = await service.get(RECORDING_ID);
      const priorVariant = before?.transcriptionVariants?.[modelId];
      if (variantCompleted(priorVariant)) {
        if (!state.completedModels.includes(modelId)) state.completedModels.push(modelId);
        await writeRunState(state);
        emit("model_skipped_complete", { modelId, ...summarizeVariant(priorVariant) });
        continue;
      }

      state.currentModel = modelId;
      await writeRunState(state);
      emit("runtime_preparing", { modelId, name: AI_ASR_MODEL_NAMES[modelId] });
      const prepared = await runtime.prepareModelRuntime(modelId);
      const statuses = await runtime.modelRuntimeStatuses();
      models.setRuntimeStatuses(statuses);
      if (!prepared.ready || statuses[modelId]?.ready !== true) {
        throw new Error(
          `runtime_not_ready:${modelId}:${statuses[modelId]?.message ?? prepared.message ?? "unknown"}`,
        );
      }

      const latest = await service.get(RECORDING_ID);
      const resumable = Boolean(
        latest?.transcriptionModel?.id === modelId &&
        latest.transcriptionUnits?.some(
          (unit) => unit.modelId === modelId && unit.status !== "completed",
        ),
      );
      emit("model_started", { modelId, resumable, filePath: RECORDING_FILE });
      const result = await service.process({
        recordingId: RECORDING_ID,
        filePath: RECORDING_FILE,
        roomId: "main",
        roomName: "一号房",
        manual: true,
        transcribe: true,
        organize: false,
        restartTranscription: !resumable,
        asrModelId: modelId,
        taskId: `verification:full:${RECORDING_ID}:${modelId}`,
        benchmark: { mode: "long" },
      });
      const variant = result.transcriptionVariants?.[modelId];
      emit("model_finished", {
        modelId,
        phase: result.phase,
        taskStatus: result.taskStatus,
        error: result.errorMessage ?? result.diagnostic?.errorMessage,
        ...summarizeVariant(variant),
      });
      if (!variantCompleted(variant) || result.taskStatus !== "success") {
        throw new Error(
          `model_verification_failed:${modelId}:${result.errorMessage ?? result.diagnostic?.errorMessage ?? "incomplete"}`,
        );
      }
      if (!state.completedModels.includes(modelId)) state.completedModels.push(modelId);
      state.currentModel = undefined;
      await writeRunState(state);
    }

    const finalRecord = (await service.get(RECORDING_ID)) as VoiceMemoryRecord;
    const results = Object.fromEntries(
      MODEL_ORDER.map((modelId) => [
        modelId,
        summarizeVariant(finalRecord.transcriptionVariants?.[modelId]),
      ]),
    );
    const allComplete = MODEL_ORDER.every((modelId) =>
      variantCompleted(finalRecord.transcriptionVariants?.[modelId]),
    );
    emit("verification_complete", {
      allComplete,
      completedModels: state.completedModels,
      results,
    });
    if (!allComplete || interrupted) process.exitCode = interrupted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    runtime.stop();
    models.stop();
  }
};

void main().catch((error) => {
  emit("verification_failed", {
    error: error instanceof Error ? (error.stack ?? error.message) : String(error),
  });
  process.exitCode = 1;
});
