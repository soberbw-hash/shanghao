import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AI_ASR_MODEL_NAMES,
  CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
  type AiAsrModelId,
  type VoiceMemoryRecord,
} from "@private-voice/shared";
import { AiModelManager } from "../src/main/ai-model-manager";
import { AiRuntimeManager } from "../src/main/ai-runtime-manager";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";
import { loadRecordingSpeakerSegments } from "../src/main/recording-speaker-segments";
import { analyzeModelComparison } from "../src/renderer/src/features/ai/modelComparisonAnalysis";

// Runs the production service against existing audio and independent durable test records.
// It never changes the user's model preference, recordings, old results, or checkpoints.
const USER_DATA = path.join(process.env.APPDATA!, "shanghao-desktop");
const AI_ROOT = path.join(process.env.LOCALAPPDATA!, "ShangHao", "AI");
const WORKSPACE_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const MODEL_ROOT = path.join(AI_ROOT, "models");
const RUNTIME_ROOT = path.join(AI_ROOT, "runtimes");
const SOURCE_RECORDS = path.join(USER_DATA, "voice-memory", "records");
// Optional bounded follow-up suite. Keep legacy full-length evidence untouched.
const benchmarkMode = process.env.SHANGHAO_MATRIX_MODE ?? "long";
if (!["smoke", "standard", "long"].includes(benchmarkMode))
  throw new Error("invalid_benchmark_mode");
const selectedRecordings = process.env.SHANGHAO_MATRIX_RECORDINGS?.split(",").filter(Boolean);
const selectedInputs = process.env.SHANGHAO_MATRIX_INPUTS
  ? (JSON.parse(process.env.SHANGHAO_MATRIX_INPUTS) as Array<{
      recordingId: string;
      filePath: string;
    }>)
  : undefined;
const suite = process.env.SHANGHAO_MATRIX_SUITE;
if (suite && !/^[a-zA-Z0-9_-]+$/.test(suite)) throw new Error("invalid_suite_name");
if ((benchmarkMode !== "long" || selectedRecordings || selectedInputs) && !suite)
  throw new Error("isolated_suite_required");
if (selectedInputs && selectedRecordings) throw new Error("choose_recordings_or_inputs");
if (selectedInputs && !process.env.SHANGHAO_MATRIX_OUTPUT_ROOT)
  throw new Error("external_matrix_output_required_for_selected_inputs");
const defaultRoot = path.join(
  USER_DATA,
  "voice-memory",
  "verification",
  suite
    ? `matrix-${suite}-${benchmarkMode}`
    : `matrix-pipeline-${CURRENT_TRANSCRIPTION_PIPELINE_VERSION}`,
);
const ROOT = process.env.SHANGHAO_MATRIX_OUTPUT_ROOT
  ? path.resolve(process.env.SHANGHAO_MATRIX_OUTPUT_ROOT)
  : defaultRoot;
if (process.env.SHANGHAO_MATRIX_OUTPUT_ROOT) {
  if (!suite) throw new Error("isolated_suite_required");
  const normalized = `${ROOT.toLowerCase()}${path.sep}`;
  for (const protectedRoot of [
    WORKSPACE_ROOT,
    USER_DATA,
    path.join(process.env.APPDATA!, "shanghao"),
    path.join(process.env.APPDATA!, "上号"),
    AI_ROOT,
  ]) {
    if (normalized.startsWith(`${path.resolve(protectedRoot).toLowerCase()}${path.sep}`))
      throw new Error("matrix_output_must_be_outside_user_data_and_ai_runtime");
  }
}
const requestedModels = process.env.SHANGHAO_MATRIX_MODELS?.split(",").filter(Boolean);
if (requestedModels?.some((id) => !(id in AI_ASR_MODEL_NAMES)))
  throw new Error("invalid_matrix_model_id");
const MODEL_IDS = (requestedModels ?? Object.keys(AI_ASR_MODEL_NAMES)) as AiAsrModelId[];
if (MODEL_IDS.length === 0 || new Set(MODEL_IDS).size !== MODEL_IDS.length)
  throw new Error("invalid_matrix_model_selection");
const mode = process.argv[2] ?? "--preflight";
const emit = (event: string, data: object = {}) =>
  process.stdout.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...data })}\n`);
const readJson = async <T>(file: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
};
const save = async (file: string, value: unknown) => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
  await rename(temporary, file);
};

async function main() {
  if (!["--preflight", "--reproduce-glm", "--run"].includes(mode))
    throw new Error("unknown_matrix_mode");
  const records: VoiceMemoryRecord[] = [];
  if (selectedInputs) {
    if (!Array.isArray(selectedInputs) || selectedInputs.length === 0)
      throw new Error("matrix_inputs_missing");
    for (const input of selectedInputs) {
      if (!/^[a-zA-Z0-9-]{1,96}$/.test(input.recordingId))
        throw new Error("invalid_matrix_recording_id");
      if (!path.isAbsolute(input.filePath) || path.extname(input.filePath).toLowerCase() !== ".m4a")
        throw new Error("invalid_matrix_recording_path");
      const file = await stat(input.filePath);
      if (!file.isFile()) throw new Error("matrix_input_not_file");
      const createdAt = file.birthtime.toISOString();
      records.push({
        schemaVersion: 1,
        recordingId: input.recordingId,
        filePath: path.resolve(input.filePath),
        createdAt,
        updatedAt: createdAt,
        phase: "idle",
        progress: 0,
        speakers: [],
        transcript: [],
        summary: [],
        chapters: [],
        highlights: [],
        markerTitles: [],
        timeline: [],
      });
    }
  } else {
    for (const name of await readdir(SOURCE_RECORDS)) {
      if (!name.endsWith(".json")) continue;
      const record = await readJson<VoiceMemoryRecord>(path.join(SOURCE_RECORDS, name));
      if (selectedRecordings && !selectedRecordings.includes(record?.recordingId ?? "")) continue;
      if (record?.filePath) {
        await stat(record.filePath); // Missing input is a visible preflight failure, never silently skipped.
        records.push(record);
      }
    }
  }
  if (new Set(records.map((record) => record.recordingId)).size !== records.length)
    throw new Error("duplicate_matrix_recording_id");
  records.sort(
    (a, b) =>
      (a.transcriptionStats?.audioDurationMs ?? Infinity) -
      (b.transcriptionStats?.audioDurationMs ?? Infinity),
  );
  if (
    selectedRecordings &&
    (records.length !== new Set(selectedRecordings).size ||
      selectedRecordings.some((id) => !records.some((record) => record.recordingId === id)))
  )
    throw new Error("requested_recording_missing");
  const state = await readJson<{ models: Record<string, { activeRevision?: string }> }>(
    path.join(MODEL_ROOT, "state.json"),
  );
  const paths = new Map<string, string>();
  for (const id of [
    ...MODEL_IDS,
    ...(MODEL_IDS.some((modelId) => modelId.startsWith("qwen3-asr-"))
      ? ["qwen3-forced-aligner-0.6b"]
      : []),
  ]) {
    const revision = state?.models[id]?.activeRevision;
    if (!revision) throw new Error(`model_active_revision_missing:${id}`);
    const directory = path.join(MODEL_ROOT, id, revision);
    await stat(directory);
    paths.set(id, directory);
  }
  const sourceFiles = [
    "../../../packages/shared/src/utils/transcriptQuality.ts",
    "../src/main/ai-runtime-manager.ts",
    "../src/main/ai-voice-memory-service.ts",
    "../src/main/asr-chunk-policy.ts",
    "../src/main/asr-benchmark-runtime.ts",
    "../src/main/asr-persistent-worker.ts",
    "../src/renderer/src/features/ai/modelComparisonAnalysis.ts",
    "./asr-runner.py",
  ];
  const digest = createHash("sha256");
  for (const file of sourceFiles)
    digest.update(await readFile(fileURLToPath(new URL(file, import.meta.url))));
  const pipelineHash = digest.digest("hex");
  const existing = await readJson<{
    pipelineHash: string;
    benchmarkMode?: string;
    recordings?: Array<{ recordingId: string }>;
  }>(path.join(ROOT, "manifest.json"));
  if (
    existing &&
    suite &&
    (existing.benchmarkMode !== benchmarkMode ||
      JSON.stringify(existing.recordings?.map((r) => r.recordingId).sort()) !==
        JSON.stringify(records.map((r) => r.recordingId).sort()))
  )
    throw new Error("suite_inputs_changed");
  if (existing && existing.pipelineHash !== pipelineHash && mode !== "--preflight") {
    throw new Error("matrix_pipeline_changed_create_new_pipeline_version_before_continuing");
  }
  await mkdir(ROOT, { recursive: true });
  const log = async (payload: { level: string; message: string }) => {
    if (payload.level !== "info")
      emit("diagnostic", { level: payload.level, message: payload.message });
  };
  const models = new AiModelManager(
    path.join(ROOT, "model-state"),
    {
      getSnapshot: () => ({ gameName: undefined }),
      onDetected: () => () => undefined,
    } as never,
    log,
    async () => {
      throw new Error("matrix_does_not_download_or_replace_model_weights");
    },
    undefined,
    [MODEL_ROOT],
  );
  await models.initialize("manual");
  const runtime = new AiRuntimeManager(
    RUNTIME_ROOT,
    { model: (id) => paths.get(id), qwen: () => undefined, activeAsr: () => MODEL_IDS[0]! },
    { writeLog: log },
  );
  const store = new VoiceMemoryStore(path.join(ROOT, "voice-memory"));
  const service = new AiVoiceMemoryService(
    models,
    runtime,
    {
      usesLocalOrganizer: () => false,
      generateJson: () => {
        throw new Error("organization_not_in_asr_matrix");
      },
    } as never,
    store,
    log,
    () => false,
  );
  let currentRecording: string | undefined;
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
    if (currentRecording) service.pause(currentRecording);
  };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    const statuses = await runtime.modelRuntimeStatuses();
    models.setRuntimeStatuses(statuses);
    emit("inventory", {
      records: records.map((r) => ({ recordingId: r.recordingId, filePath: r.filePath })),
      models: MODEL_IDS.map((id) => ({ id, ...statuses[id] })),
      outputDirectory: ROOT,
    });
    if (mode === "--preflight") return;
    for (const id of MODEL_IDS)
      if (!statuses[id]?.ready) throw new Error(`runtime_not_ready:${id}:${statuses[id]?.message}`);
    const bundledRunner = await readFile(
      fileURLToPath(new URL("./asr-runner.py", import.meta.url)),
    );
    const installedRunner = await readFile(path.join(RUNTIME_ROOT, "asr-runner.py"));
    if (!bundledRunner.equals(installedRunner))
      throw new Error("installed_asr_runner_differs_from_source_no_runtime_overwrite");
    if (mode === "--reproduce-glm") {
      const record = records.find((r) => r.recordingId === "71140c19-40da-4a72-a3df-41e3bc5276ff");
      if (!record) throw new Error("glm_source_missing");
      const unit = record.transcriptionVariants?.["glm-asr-nano-2512"]?.transcriptionUnits?.find(
        (u) => u.status === "failed",
      );
      if (!unit) throw new Error("glm_failed_unit_missing");
      const sources = await loadRecordingSpeakerSegments(record.recordingId, record.filePath);
      const source = sources?.find(
        (s) =>
          (s.userId ?? s.speakerId) === unit.speakerId &&
          s.startMs <= unit.startMs &&
          s.endMs >= unit.endMs,
      );
      if (unit.speakerId && !source) throw new Error("glm_exact_speaker_source_missing");
      const attempts: unknown[] = [];
      for (let attempt = 1; attempt <= 2; attempt++) {
        emit("glm_reproduction_started", { attempt, startMs: unit.startMs, endMs: unit.endMs });
        try {
          const result = await runtime.transcribeChunk({
            modelId: "glm-asr-nano-2512",
            recordingId: record.recordingId,
            filePath: source?.filePath ?? record.filePath,
            offsetMs: source ? unit.startMs - source.startMs : unit.startMs,
            durationMs: unit.endMs - unit.startMs,
            benchmark: true,
            resourceMode: "normal",
          });
          attempts.push({ attempt, result });
          emit("glm_reproduction_finished", {
            attempt,
            outputStatus: result.outputStatus,
            timing: result.timing,
          });
        } catch (error) {
          attempts.push({
            attempt,
            error: String(error),
            stderr: (error as Error & { stderr?: string }).stderr,
          });
        }
      }
      const release = await runtime.releaseAsrMeasured("matrix_glm_reproduction_complete");
      await save(path.join(ROOT, "glm-reproduction.json"), {
        recordingId: record.recordingId,
        sourceStartMs: unit.startMs,
        sourceEndMs: unit.endMs,
        sourceFile: source?.filePath ?? record.filePath,
        attempts,
        release,
      });
      return;
    }
    await save(path.join(ROOT, "manifest.json"), {
      ...existing,
      pipelineHash,
      pipelineVersion: CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
      benchmarkMode,
      modelIds: MODEL_IDS,
      recordings: records.map((r) => ({ recordingId: r.recordingId, filePath: r.filePath })),
    });
    await service.initialize();
    const progress = new Map<string, number>();
    service.onStatus((record) => {
      const key = `${record.recordingId}:${record.transcriptionModel?.id}`;
      const completed = record.transcriptionStats?.completedUnits ?? 0;
      if (progress.get(key) === completed) return;
      progress.set(key, completed);
      emit("progress", {
        recordingId: record.recordingId,
        modelId: record.transcriptionModel?.id,
        completedUnits: completed,
        totalUnits: record.transcriptionStats?.totalUnits,
        failedUnits: record.transcriptionStats?.failedUnits,
      });
    });
    for (const recording of records) {
      currentRecording = recording.recordingId;
      for (const modelId of MODEL_IDS) {
        if (interrupted) return;
        const resultFile = path.join(ROOT, "results", `${recording.recordingId}.${modelId}.json`);
        if (await readJson(resultFile)) continue;
        const prior = await service.get(recording.recordingId);
        const resumable =
          prior?.transcriptionModel?.id === modelId &&
          (prior.transcriptionPipelineVersion === CURRENT_TRANSCRIPTION_PIPELINE_VERSION ||
            (Boolean(prior.transcriptionUnits?.length) &&
              prior.transcriptionUnits!.every(
                (unit) =>
                  unit.modelId === modelId &&
                  unit.pipelineVersion === CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
              )));
        emit("model_started", {
          recordingId: recording.recordingId,
          filePath: recording.filePath,
          modelId,
        });
        await save(path.join(ROOT, "current.json"), {
          pid: process.pid,
          phase: "running",
          recordingId: recording.recordingId,
          filePath: recording.filePath,
          modelId,
          startedAt: new Date().toISOString(),
        });
        const result = await service.process({
          recordingId: recording.recordingId,
          filePath: recording.filePath,
          roomId: recording.roomId,
          roomName: recording.roomName,
          manual: true,
          transcribe: true,
          organize: false,
          restartTranscription: !resumable,
          asrModelId: modelId,
          taskId: `matrix:${benchmarkMode}:${recording.recordingId}:${modelId}`,
          benchmark: { mode: benchmarkMode as "smoke" | "standard" | "long" },
        });
        if (result.phase === "paused" || interrupted) return;
        const release = await runtime.releaseAsrMeasured("matrix_model_boundary");
        if (!release.workerExitedAt) throw new Error("matrix_worker_did_not_exit");
        const analysis = analyzeModelComparison({
          record: result,
          modelIds: MODEL_IDS,
          results: {},
        });
        const model = analysis.modelSummary.find((entry) => entry.modelId === modelId);
        await save(resultFile, {
          pipelineHash,
          phase: result.phase,
          taskStatus: result.taskStatus,
          error: result.errorMessage,
          model,
          release,
          variant: result.transcriptionVariants?.[modelId] ?? {
            transcript: result.transcript,
            transcriptionStats: result.transcriptionStats,
            transcriptionUnits: result.transcriptionUnits,
          },
        });
        await save(path.join(ROOT, "summaries", `${recording.recordingId}.json`), analysis);
        emit("model_finished", {
          recordingId: recording.recordingId,
          modelId,
          status: model?.status,
          validity: model?.dataValidity,
          failedUnits: model?.failedUnits,
        });
      }
    }
    await save(path.join(ROOT, "current.json"), {
      phase: "complete",
      completedAt: new Date().toISOString(),
      recordings: records.length,
      models: MODEL_IDS.length,
    });
    emit("matrix_complete", { recordings: records.length, models: MODEL_IDS.length });
  } finally {
    await runtime.releaseAsrMeasured("matrix_stopping");
    runtime.stop();
    models.stop();
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}
void main().catch((error) => {
  emit("matrix_failed", { error: error instanceof Error ? error.stack : String(error) });
  process.exitCode = 1;
});
