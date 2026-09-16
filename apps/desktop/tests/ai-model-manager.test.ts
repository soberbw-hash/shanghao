import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AiModelManager,
  buildResumeHeaders,
  classifyAiModelFailure,
  describeAiModelError,
  GAMING_DOWNLOAD_BYTES_PER_SECOND,
  MODEL_SOURCES,
  NORMAL_DOWNLOAD_BYTES_PER_SECOND,
  PINNED_MODEL_REVISIONS,
  safeRelativeModelPath,
  validateModelRevisionFiles,
  type RemoteModelFile,
} from "../src/main/ai-model-manager";

class FakeGameDetection {
  private listener?: (snapshot: { gameName?: string }) => void;

  getSnapshot() {
    return { checkedAt: new Date().toISOString() };
  }

  onDetected(listener: (snapshot: { gameName?: string }) => void) {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  setGame(gameName?: string) {
    this.listener?.({ gameName });
  }
}

test("AI models remain opt-in and game activity lowers background priority", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-models-"));
  const games = new FakeGameDetection();
  const manager = new AiModelManager(directory, games as never, async () => undefined);
  await manager.initialize("after_game");

  let snapshot = manager.getSnapshot();
  assert.equal(
    snapshot.models.every((model) => model.phase === "not_installed"),
    true,
  );
  assert.equal(
    snapshot.models.every((model) => model.userInstalled === false),
    true,
  );
  assert.deepEqual(
    snapshot.models.filter((model) => model.category === "asr").map((model) => model.id),
    [
      "qwen3-asr-1.7b-force",
      "qwen3-asr-0.6b-force",
      "fun-asr-nano-2512",
      "glm-asr-nano-2512",
      "fireredasr2-aed",
      "paraformer-zh",
      "moss-transcribe-diarize-0.9b-q8_0",
      "ark-asr-3b-q8_0",
    ],
  );
  assert.equal(
    snapshot.models.find((model) => model.id === "qwen3-forced-aligner-0.6b")?.category,
    "support",
  );
  assert.equal(
    snapshot.models.some((model) => model.category === "organizer"),
    false,
  );
  assert.equal(manager.getActiveAsrModel(), "qwen3-asr-0.6b-force");
  assert.equal(manager.canRunTask("transcription").requiredModel, "qwen3-asr-0.6b-force");
  manager.setActiveAsrModel("paraformer-zh");
  assert.equal(manager.canRunTask("transcription").requiredModel, "paraformer-zh");
  assert.equal(
    manager.canRunTask("transcription", false, "qwen3-asr-1.7b-force").requiredModel,
    "qwen3-asr-1.7b-force",
  );
  assert.equal(snapshot.scheduler.processingMode, "after_game");

  games.setGame("三角洲行动");
  snapshot = manager.getSnapshot();
  assert.equal(snapshot.scheduler.gameActive, true);
  assert.equal(snapshot.scheduler.downloadsThrottled, true);
  assert.equal(snapshot.scheduler.aiTasksPausedForGame, true);
  assert.equal(manager.canRunTask("transcription").runnable, false);
  assert.equal(manager.canRunTask("transcription").resourceMode, "low");
  assert.equal(GAMING_DOWNLOAD_BYTES_PER_SECOND < NORMAL_DOWNLOAD_BYTES_PER_SECOND, true);

  manager.setRuntimeStatuses({
    "fun-asr-nano-2512": { ready: true },
    "qwen3-forced-aligner-0.6b": { ready: true },
  });
  assert.equal(
    manager.getSnapshot().models.find((model) => model.id === "fun-asr-nano-2512")?.runtimeReady,
    true,
  );

  manager.stop();
  await rm(directory, { recursive: true, force: true });
});

test("repairing an installed model only prepares its runtime and keeps its downloaded revision", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-model-repair-"));
  const games = new FakeGameDetection();
  const manager = new AiModelManager(directory, games as never, async () => undefined);
  await manager.initialize("manual");
  const internal = manager as unknown as {
    persisted: {
      models: Record<string, { userInstalled: boolean; activeRevision?: string; phase?: string }>;
    };
  };
  internal.persisted.models["fun-asr-nano-2512"] = {
    userInstalled: true,
    activeRevision: "already-downloaded",
    phase: "installed",
  };
  const repaired: string[] = [];
  manager.setRuntimePreparer(async (id) => {
    repaired.push(id);
    return { ready: true };
  });
  try {
    const snapshot = await manager.controlModel("fun-asr-nano-2512", "repair");
    const model = snapshot.models.find((candidate) => candidate.id === "fun-asr-nano-2512");
    assert.deepEqual(repaired, ["fun-asr-nano-2512"]);
    assert.equal(model?.phase, "installed");
    assert.equal(model?.runtimeReady, true);
  } finally {
    manager.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed runtime repair stays installed but cannot report success", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-runtime-failure-"));
  const games = new FakeGameDetection();
  const manager = new AiModelManager(directory, games as never, async () => undefined);
  await manager.initialize("manual");
  const internal = manager as unknown as {
    persisted: {
      models: Record<string, { userInstalled: boolean; activeRevision?: string; phase?: string }>;
    };
  };
  internal.persisted.models["fireredasr2-aed"] = {
    userInstalled: true,
    activeRevision: "already-downloaded",
    phase: "installed",
  };
  manager.setRuntimePreparer(async () => ({ ready: false, message: "运行组件缺失" }));
  try {
    await assert.rejects(manager.controlModel("fireredasr2-aed", "repair"), /运行组件缺失/);
    const model = manager
      .getSnapshot()
      .models.find((candidate) => candidate.id === "fireredasr2-aed");
    assert.equal(model?.phase, "installed");
    assert.equal(model?.runtimeReady, false);
    assert.equal(model?.runtimeMessage, "运行组件缺失");
    assert.equal(model?.activeRevision, "already-downloaded");
  } finally {
    manager.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a complete ASR model from the legacy development directory is reused without a duplicate copy", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-current-store-"));
  const legacy = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-legacy-store-"));
  const modelId = "qwen3-asr-0.6b-force";
  const revision = PINNED_MODEL_REVISIONS[modelId];
  const legacyRevision = path.join(legacy, modelId, revision);
  await mkdir(legacyRevision, { recursive: true });
  await writeFile(
    path.join(legacy, "state.json"),
    JSON.stringify({
      models: {
        [modelId]: {
          userInstalled: true,
          phase: "installed",
          activeRevision: revision,
          downloadedBytes: 23_462_477_857,
          totalBytes: 23_462_477_857,
        },
      },
      taskCheckpoints: {},
    }),
    "utf8",
  );
  const manager = new AiModelManager(
    directory,
    new FakeGameDetection() as never,
    async () => undefined,
    globalThis.fetch,
    undefined,
    [legacy],
  );
  try {
    await manager.initialize("manual");
    assert.equal(manager.getActiveModelDirectory(modelId), legacyRevision);
    assert.equal(
      manager.getSnapshot().models.find((model) => model.id === modelId)?.activeRevision,
      revision,
    );
    await assert.rejects(stat(path.join(directory, modelId)));
  } finally {
    manager.stop();
    await rm(directory, { recursive: true, force: true });
    await rm(legacy, { recursive: true, force: true });
  }
});

test("AI model paths reject traversal and persisted partial state resumes after restart", async () => {
  assert.equal(
    safeRelativeModelPath("weights/model-00001.safetensors"),
    "weights/model-00001.safetensors",
  );
  assert.throws(() => safeRelativeModelPath("../outside.bin"), /unsafe_ai_model_path/);
  assert.throws(() => safeRelativeModelPath(".."), /unsafe_ai_model_path/);
  assert.throws(() => safeRelativeModelPath("C:/outside.bin"), /unsafe_ai_model_path/);
  assert.throws(() => safeRelativeModelPath("/absolute.bin"), /unsafe_ai_model_path/);
  assert.deepEqual(buildResumeHeaders(600), { Range: "bytes=600-" });
  assert.equal(buildResumeHeaders(0), undefined);

  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-resume-"));
  const games = new FakeGameDetection();
  const statePath = path.join(directory, "state.json");
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(
      statePath,
      JSON.stringify({
        models: {
          "qwen3-asr-0.6b-force": {
            userInstalled: true,
            phase: "paused",
            pendingRevision: "test-revision",
            downloadedBytes: 600,
            totalBytes: 1_000,
          },
        },
        taskCheckpoints: {},
      }),
    ),
  );
  const manager = new AiModelManager(directory, games as never, async () => undefined);
  await manager.initialize("manual");
  try {
    const model = manager
      .getSnapshot()
      .models.find((candidate) => candidate.id === "qwen3-asr-0.6b-force");
    assert.ok(["paused", "queued", "checking", "downloading"].includes(model?.phase ?? ""));
    assert.equal(model?.progress, 60);
    assert.equal(
      JSON.parse(await readFile(statePath, "utf8")).models["qwen3-asr-0.6b-force"].userInstalled,
      true,
    );
  } finally {
    manager.stop();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await rm(directory, { recursive: true, force: true });
  }
});

test("AI model downloads have a mainland fallback and readable failure messages", () => {
  assert.equal(MODEL_SOURCES[0]?.baseUrl, "https://hf-mirror.com");
  assert.equal(
    MODEL_SOURCES.some((source) => source.baseUrl === "https://huggingface.co"),
    true,
  );
  assert.match(describeAiModelError(new Error("fetch failed")), /国内镜像/);
  assert.match(describeAiModelError(new Error("ai_model_disk_space_insufficient")), /磁盘/);
  assert.match(describeAiModelError(new Error("ai_model_file_incomplete")), /继续/);
  assert.equal(classifyAiModelFailure(new Error("ai_model_checksum_mismatch")), "integrity");
  assert.equal(classifyAiModelFailure(new Error("fetch failed")), "network");
  assert.equal(classifyAiModelFailure(new Error("ai_model_disk_space_insufficient")), "disk");
  assert.equal(classifyAiModelFailure(new Error("ai_model_access_token_required")), "access");
  assert.equal(classifyAiModelFailure(new Error("ai_model_manifest_http_403")), "access");
  assert.equal(classifyAiModelFailure(new Error("unknown_download_failure")), "download");
  assert.match(describeAiModelError(new Error("ai_model_manifest_http_503")), /HTTP 503/);
  assert.match(describeAiModelError(new Error("ai_model_access_token_required")), /只读 Token/);
  assert.match(describeAiModelError(new Error("ai_model_manifest_http_401")), /Token/);
  assert.equal(
    PINNED_MODEL_REVISIONS["qwen3-asr-0.6b-force"],
    "5eb144179a02acc5e5ba31e748d22b0cf3e303b0",
  );
  assert.equal(
    PINNED_MODEL_REVISIONS["qwen3-forced-aligner-0.6b"],
    "c7cbfc2048c462b0d63a45797104fc9db3ad62b7",
  );
  assert.equal(PINNED_MODEL_REVISIONS["paraformer-zh"], "bundle-d7811ee3-df20e6b3-d0e55e2b");
  assert.equal(
    PINNED_MODEL_REVISIONS["moss-transcribe-diarize-0.9b-q8_0"],
    "6fdfa33aed776bbb0ac11a1a9835634fe6d75dd7",
  );
  assert.equal(
    PINNED_MODEL_REVISIONS["ark-asr-3b-q8_0"],
    "3f228f0d7835ded6e73f399286695534001e4cb2",
  );
});

test("gated model authorization stays on the official host and out of logs", async () => {
  const managerSource = await readFile(
    new URL("../src/main/ai-model-manager.ts", import.meta.url),
    "utf8",
  );
  const accessStoreSource = await readFile(
    new URL("../src/main/hugging-face-access-store.ts", import.meta.url),
    "utf8",
  );

  assert.match(managerSource, /requiresHuggingFaceAuthorization/);
  assert.match(managerSource, /source\.baseUrl === "https:\/\/huggingface\.co"/);
  assert.match(managerSource, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(accessStoreSource, /safeStorage\.encryptStringAsync/);
  assert.doesNotMatch(accessStoreSource, /context:\s*\{[^}]*token/i);
  assert.doesNotMatch(accessStoreSource, /console\.(?:log|error)/);
});

const writeModelFixture = async (
  directory: string,
  contents: Record<string, string>,
): Promise<RemoteModelFile[]> => {
  const files: RemoteModelFile[] = [];
  for (const [name, content] of Object.entries(contents)) {
    const filePath = path.join(directory, name);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    files.push({
      rfilename: name,
      size: Buffer.byteLength(content),
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  return files;
};

test("Fun-ASR and FireRed validate their official layouts without config.json", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-model-layout-"));
  const funDirectory = path.join(directory, "fun");
  const fireRedDirectory = path.join(directory, "firered");
  try {
    const funFiles = await writeModelFixture(funDirectory, {
      "model.pt": "fun-weights",
      "config.yaml": "model: FunASRNano",
      "configuration.json": "{}",
      "multilingual.tiktoken": "tokenizer",
    });
    await validateModelRevisionFiles("fun-asr-nano-2512", funDirectory, funFiles);

    const fireRedFiles = await writeModelFixture(fireRedDirectory, {
      "model.pth.tar": "firered-weights",
      "config.yaml": "",
      "cmvn.ark": "cmvn",
      "dict.txt": "dictionary",
      "train_bpe1000.model": "bpe",
    });
    await validateModelRevisionFiles("fireredasr2-aed", fireRedDirectory, fireRedFiles);
    assert.equal(
      fireRedFiles.some((file) => file.rfilename.endsWith(".safetensors")),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("MOSS Q8 and ARK Q8 use independent pinned file layouts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-new-asr-layout-"));
  try {
    const mossQ8Directory = path.join(directory, "moss-q8");
    const mossQ8Files = await writeModelFixture(mossQ8Directory, {
      "MOSS-Transcribe-Diarize-Q8_0.gguf": "moss-q8-weights",
    });
    await validateModelRevisionFiles(
      "moss-transcribe-diarize-0.9b-q8_0",
      mossQ8Directory,
      mossQ8Files,
    );

    const arkDirectory = path.join(directory, "ark");
    const arkFiles = await writeModelFixture(arkDirectory, {
      "ark-asr-3b-q8_0.gguf": "ark-q8-weights",
    });
    await validateModelRevisionFiles("ark-asr-3b-q8_0", arkDirectory, arkFiles);
    await assert.rejects(
      validateModelRevisionFiles("ark-asr-3b-q8_0", arkDirectory, [
        { rfilename: "ark-asr-3b-q6_k.gguf", size: 1 },
      ]),
      /ai_model_required_files_missing/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("checksum failures stay integrity failures and remove only the corrupt file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-model-checksum-"));
  try {
    const files = await writeModelFixture(directory, {
      "model.pt": "fun-weights",
      "config.yaml": "model: FunASRNano",
      "configuration.json": "{}",
      "multilingual.tiktoken": "tokenizer",
    });
    const weight = files.find((file) => file.rfilename === "model.pt");
    assert.ok(weight);
    weight.sha256 = "0".repeat(64);
    await assert.rejects(
      validateModelRevisionFiles("fun-asr-nano-2512", directory, files),
      /ai_model_checksum_mismatch/,
    );
    await assert.rejects(stat(path.join(directory, "model.pt")));
    assert.equal(await readFile(path.join(directory, "config.yaml"), "utf8"), "model: FunASRNano");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
