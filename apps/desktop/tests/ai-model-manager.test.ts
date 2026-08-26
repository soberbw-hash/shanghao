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
      "moss-transcribe-diarize-0.9b",
      "dolphin-cn-dialect-0.4b",
      "cohere-transcribe-2b",
    ],
  );
  assert.equal(
    snapshot.models.find((model) => model.id === "qwen3-forced-aligner-0.6b")?.category,
    "support",
  );
  assert.equal(snapshot.models.find((model) => model.id === "qwen35-4b")?.category, "organizer");
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
  internal.persisted.models["dolphin-cn-dialect-0.4b"] = {
    userInstalled: true,
    activeRevision: "already-downloaded",
    phase: "installed",
  };
  manager.setRuntimePreparer(async () => ({ ready: false, message: "torch-complex 缺失" }));
  try {
    await assert.rejects(
      manager.controlModel("dolphin-cn-dialect-0.4b", "repair"),
      /torch-complex 缺失/,
    );
    const model = manager
      .getSnapshot()
      .models.find((candidate) => candidate.id === "dolphin-cn-dialect-0.4b");
    assert.equal(model?.phase, "installed");
    assert.equal(model?.runtimeReady, false);
    assert.equal(model?.runtimeMessage, "torch-complex 缺失");
    assert.equal(model?.activeRevision, "already-downloaded");
  } finally {
    manager.stop();
    await rm(directory, { recursive: true, force: true });
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
    PINNED_MODEL_REVISIONS["moss-transcribe-diarize-0.9b"],
    "e8681d68e7042738ffca8ac8212bc8fcb1131ab8",
  );
  assert.equal(
    PINNED_MODEL_REVISIONS["dolphin-cn-dialect-0.4b"],
    "eb6854969b5715cfccf4a9297a75f189343700dc",
  );
  assert.equal(
    PINNED_MODEL_REVISIONS["cohere-transcribe-2b"],
    "00c06981f239c788c0ce23b8caa001c071e4e391",
  );
  assert.equal(PINNED_MODEL_REVISIONS["qwen35-4b"], "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a");
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

test("MOSS, Dolphin small.cn and Cohere use independent official file layouts", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-new-asr-layout-"));
  try {
    const mossDirectory = path.join(directory, "moss");
    const mossFiles = await writeModelFixture(mossDirectory, {
      "config.json": "{}",
      "preprocessor_config.json": "{}",
      "processor_config.json": "{}",
      "tokenizer_config.json": "{}",
      "model-00000-of-00001.safetensors": "moss-official-weights",
    });
    await validateModelRevisionFiles("moss-transcribe-diarize-0.9b", mossDirectory, mossFiles);

    const dolphinDirectory = path.join(directory, "dolphin");
    const dolphinFiles = await writeModelFixture(dolphinDirectory, {
      "small.cn.pt": "dolphin-small-cn-weights",
      "train.yaml": "model: small.cn",
      "units.txt": "tokens",
      global_cmvn: "cmvn",
    });
    await validateModelRevisionFiles("dolphin-cn-dialect-0.4b", dolphinDirectory, dolphinFiles);
    assert.equal(
      dolphinFiles.some((file) => file.rfilename === "base.cn.pt"),
      false,
    );
    assert.equal(
      dolphinFiles.some((file) => file.rfilename.includes("streaming")),
      false,
    );

    const cohereDirectory = path.join(directory, "cohere");
    const cohereFiles = await writeModelFixture(cohereDirectory, {
      "config.json": "{}",
      "preprocessor_config.json": "{}",
      "processor_config.json": "{}",
      "tokenizer_config.json": "{}",
      "model.safetensors": "cohere-official-weights",
    });
    await validateModelRevisionFiles("cohere-transcribe-2b", cohereDirectory, cohereFiles);
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
