import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AiModelManager,
  buildResumeHeaders,
  describeAiModelError,
  GAMING_DOWNLOAD_BYTES_PER_SECOND,
  MODEL_SOURCES,
  NORMAL_DOWNLOAD_BYTES_PER_SECOND,
  PINNED_MODEL_REVISIONS,
  safeRelativeModelPath,
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

  manager.stop();
  await rm(directory, { recursive: true, force: true });
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
    assert.ok(["paused", "checking", "downloading"].includes(model?.phase ?? ""));
    assert.equal(model?.progress, 60);
    assert.equal(
      JSON.parse(await readFile(statePath, "utf8")).models["qwen3-asr-0.6b-force"].userInstalled,
      true,
    );
  } finally {
    manager.stop();
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
  assert.match(describeAiModelError(new Error("ai_model_manifest_http_503")), /HTTP 503/);
  assert.equal(
    PINNED_MODEL_REVISIONS["qwen3-asr-0.6b-force"],
    "5eb144179a02acc5e5ba31e748d22b0cf3e303b0",
  );
  assert.equal(
    PINNED_MODEL_REVISIONS["qwen3-forced-aligner-0.6b"],
    "c7cbfc2048c462b0d63a45797104fc9db3ad62b7",
  );
  assert.equal(PINNED_MODEL_REVISIONS["paraformer-zh"], "bundle-d7811ee3-df20e6b3-d0e55e2b");
  assert.equal(PINNED_MODEL_REVISIONS["qwen35-4b"], "851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a");
});
