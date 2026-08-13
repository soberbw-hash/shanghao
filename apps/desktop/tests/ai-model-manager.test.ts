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
          vibevoice: {
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
  const model = manager.getSnapshot().models.find((candidate) => candidate.id === "vibevoice");
  assert.equal(model?.phase, "paused");
  assert.equal(model?.progress, 60);
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).models.vibevoice.userInstalled, true);

  manager.stop();
  await rm(directory, { recursive: true, force: true });
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
});
