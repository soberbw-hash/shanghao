import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import type { AiModelId } from "@private-voice/shared";

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

test("invalid model state is preserved and cannot trigger a model deletion", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-model-state-damaged-"));
  const statePath = path.join(directory, "state.json");
  const modelPath = path.join(directory, "glm-asr-nano-2512", "existing", "weights.bin");
  try {
    await mkdir(path.dirname(modelPath), { recursive: true });
    await writeFile(modelPath, "keep model bytes", "utf8");
    await writeFile(statePath, "corrupted model state", "utf8");
    const manager = new AiModelManager(
      directory,
      new FakeGameDetection() as never,
      async () => undefined,
    );
    await assert.rejects(manager.initialize("manual"), /ai_model_state_invalid/);
    await assert.rejects(
      manager.controlModel("glm-asr-nano-2512", "delete"),
      /ai_model_state_unavailable/,
    );
    await assert.rejects(manager.clearTaskCheckpoint("old-task"), /ai_model_state_unavailable/);
    assert.equal(await readFile(statePath, "utf8"), "corrupted model state");
    assert.equal(await readFile(modelPath, "utf8"), "keep model bytes");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid model state structure is not replaced by an empty catalog", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-model-state-schema-"));
  const statePath = path.join(directory, "state.json");
  const state = JSON.stringify({ models: [], taskCheckpoints: {} });
  try {
    await writeFile(statePath, state, "utf8");
    const manager = new AiModelManager(
      directory,
      new FakeGameDetection() as never,
      async () => undefined,
    );
    await assert.rejects(manager.initialize("manual"), /ai_model_state_invalid/);
    assert.equal(await readFile(statePath, "utf8"), state);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancelled model download waiters cannot consume the next download slot", async () => {
  const manager = new AiModelManager(
    "unused",
    new FakeGameDetection() as never,
    async () => undefined,
  );
  const slots = manager as unknown as {
    acquireDownloadSlot: (signal: AbortSignal) => Promise<() => void>;
    activeModelDownloads: number;
    downloadSlotWaiters: unknown[];
  };
  const first = await slots.acquireDownloadSlot(new AbortController().signal);
  const second = await slots.acquireDownloadSlot(new AbortController().signal);
  const cancelledController = new AbortController();
  const cancelled = slots.acquireDownloadSlot(cancelledController.signal);
  const next = slots.acquireDownloadSlot(new AbortController().signal);
  cancelledController.abort();
  await assert.rejects(cancelled, /download_paused/i);
  first();
  const nextRelease = await next;
  assert.equal(slots.activeModelDownloads, 2);
  second();
  nextRelease();
  assert.equal(slots.activeModelDownloads, 0);
  assert.equal(slots.downloadSlotWaiters.length, 0);
});

test("a download cancellation during waiter registration is not lost", async () => {
  const manager = new AiModelManager(
    "unused",
    new FakeGameDetection() as never,
    async () => undefined,
  );
  const slots = manager as unknown as {
    acquireDownloadSlot: (signal: AbortSignal) => Promise<() => void>;
    downloadSlotWaiters: unknown[];
  };
  const first = await slots.acquireDownloadSlot(new AbortController().signal);
  const second = await slots.acquireDownloadSlot(new AbortController().signal);
  const racedSignal = {
    aborted: false,
    addEventListener() {
      this.aborted = true;
    },
    removeEventListener: () => undefined,
  } as unknown as AbortSignal;
  await assert.rejects(slots.acquireDownloadSlot(racedSignal), /download_paused/i);
  assert.equal(slots.downloadSlotWaiters.length, 0);
  first();
  second();
});

test("model download rejects excess response bytes before they fill the partial file", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-model-oversized-"));
  try {
    const manager = new AiModelManager(
      directory,
      new FakeGameDetection() as never,
      async () => undefined,
    );
    Object.assign(manager, {
      fetchFromModelSources: async () => ({
        response: new Response("more than expected", { status: 200 }),
        release: () => undefined,
      }),
    });
    const internal = manager as unknown as {
      downloadFile: (
        id: string,
        revision: string,
        file: Record<string, unknown>,
        signal: AbortSignal,
        state: Record<string, unknown>,
      ) => Promise<void>;
    };
    await assert.rejects(
      internal.downloadFile(
        "glm-asr-nano-2512",
        "test-revision",
        {
          rfilename: "weights.bin",
          sourceRepository: "test/model",
          sourceRevision: "test-revision",
          sourceFileName: "weights.bin",
          size: 2,
        },
        new AbortController().signal,
        { userInstalled: true, totalBytes: 2, downloadedBytes: 0 },
      ),
      /ai_model_file_oversized/,
    );
    const partial = path.join(directory, "glm-asr-nano-2512", "test-revision", "weights.bin.part");
    const partialSize = await stat(partial)
      .then((value) => value.size)
      .catch(() => 0);
    assert.equal(partialSize <= 2, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("model manifest ignores file sizes that cannot bound a download", async () => {
  const manager = new AiModelManager(
    "unused",
    new FakeGameDetection() as never,
    async () => undefined,
  );
  Object.assign(manager, {
    fetchManifest: async () => ({
      sha: "test-revision",
      siblings: [
        { rfilename: "weights.bin", size: 2 },
        { rfilename: "infinite.bin", size: Number.POSITIVE_INFINITY },
        { rfilename: "fraction.bin", size: 1.5 },
        { rfilename: "negative.bin", size: -1 },
      ],
    }),
  });
  const internal = manager as unknown as {
    fetchDownloadFiles: (
      definition: Record<string, unknown>,
    ) => Promise<Array<{ rfilename: string }>>;
  };
  const files = await internal.fetchDownloadFiles({
    id: "glm-asr-nano-2512",
    repository: "test/model",
    revision: "test-revision",
  });
  assert.deepEqual(
    files.map((file) => file.rfilename),
    ["weights.bin"],
  );
  assert.equal(classifyAiModelFailure(new Error("ai_model_file_oversized")), "integrity");
  assert.match(describeAiModelError(new Error("ai_model_file_oversized")), /超过清单大小/);
});

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

test("AI task status keeps the remaining task when concurrent work finishes out of order", () => {
  const games = new FakeGameDetection();
  const manager = new AiModelManager(
    "unused-test-directory",
    games as never,
    async () => undefined,
  );
  const first = manager.markQwenTaskStarted("organize:local");
  const second = manager.markQwenTaskStarted("question:local");
  assert.equal(manager.getSnapshot().scheduler.runningTask, "question:local");
  manager.markAiTaskFinished(first);
  assert.equal(manager.getSnapshot().scheduler.runningTask, "question:local");
  manager.markAiTaskFinished(second);
  assert.equal(manager.getSnapshot().scheduler.runningTask, undefined);
  manager.markAiTaskFinished(first);
  assert.equal(manager.getSnapshot().scheduler.runningTask, undefined);
  manager.stop();
});

test("AI compute status follows the lease and recovers when ASR preparation fails", async () => {
  const manager = new AiModelManager(
    "unused-test-directory",
    new FakeGameDetection() as never,
    async () => undefined,
  );
  const first = await manager.acquireComputeSlot("summary", true);
  const waiting = manager.acquireComputeSlot("transcription", true);
  assert.equal(manager.getSnapshot().scheduler.computeActiveKind, "summary");
  assert.equal(manager.getSnapshot().scheduler.computeWaiting, 1);
  first.release();
  const second = await waiting;
  assert.equal(manager.getSnapshot().scheduler.computeActiveKind, "transcription");
  second.release();
  assert.equal(manager.getSnapshot().scheduler.computeActiveKind, undefined);

  const unsubscribe = manager.onQwenReleaseRequested(() => {
    throw new Error("release_listener_failed");
  });
  await assert.rejects(
    manager.acquireComputeSlot("transcription", true),
    /release_listener_failed/,
  );
  assert.equal(manager.getSnapshot().scheduler.computeActiveKind, undefined);
  unsubscribe();
  manager.stop();
});

test("recording pressure publishes a stopping phase without repeating unchanged status", async () => {
  const manager = new AiModelManager(
    "unused-test-directory",
    new FakeGameDetection() as never,
    async () => undefined,
  );
  manager.setProcessingMode("immediate");
  const lease = await manager.acquireComputeSlot("summary", false);
  let notifications = 0;
  const unsubscribe = manager.onStatus(() => {
    notifications += 1;
  });
  const pressure = {
    inVoiceRoom: true,
    recordingActive: true,
    screenSharing: false,
    peerRecovering: false,
    latencyMs: 0,
    packetLossPercent: 0,
    rendererMemoryPressure: false,
    updatedAt: Date.now(),
  };
  manager.updateRuntimePressure(pressure);
  assert.equal(lease.signal.aborted, true);
  assert.equal(manager.getSnapshot().scheduler.recordingActive, true);
  assert.equal(manager.getSnapshot().scheduler.computeActivePhase, "stopping");
  assert.equal(manager.getSnapshot().scheduler.computeStoppingReason, "recording_priority");
  assert.equal(notifications, 1);
  manager.updateRuntimePressure({ ...pressure, updatedAt: Date.now() + 1 });
  assert.equal(notifications, 1);
  lease.release();
  assert.equal(manager.getSnapshot().scheduler.computeActivePhase, undefined);
  unsubscribe();
  manager.stop();
});

test("stale network observations expire without forgetting an active room or recording", async () => {
  const manager = new AiModelManager(
    "unused-test-directory",
    new FakeGameDetection() as never,
    async () => undefined,
    undefined,
    undefined,
    [],
    20,
  );
  try {
    manager.updateRuntimePressure({
      inVoiceRoom: true,
      recordingActive: true,
      screenSharing: false,
      peerRecovering: true,
      latencyMs: 400,
      packetLossPercent: 12,
      rendererMemoryPressure: true,
      updatedAt: Date.now(),
    });
    assert.equal(manager.getSnapshot().scheduler.realtimePressureHigh, true);
    await delay(60);
    const snapshot = manager.getSnapshot().scheduler;
    assert.equal(snapshot.realtimePressureHigh, false);
    assert.equal(snapshot.pressureReason, undefined);
    assert.equal(snapshot.recordingActive, true);
    assert.equal(snapshot.downloadsThrottled, true);
    assert.equal(manager.shouldDeferBackgroundDownload(), false);
  } finally {
    manager.stop();
  }
});

test("external cancellation publishes the active AI slot stopping state", async () => {
  const manager = new AiModelManager(
    "unused-test-directory",
    new FakeGameDetection() as never,
    async () => undefined,
  );
  const controller = new AbortController();
  const lease = await manager.acquireComputeSlot("summary", true, controller.signal);
  let observedPhase: string | undefined;
  const unsubscribe = manager.onStatus((snapshot) => {
    observedPhase = snapshot.scheduler.computeActivePhase;
  });
  controller.abort();
  assert.equal(observedPhase, "stopping");
  assert.equal(manager.getSnapshot().scheduler.computeStoppingReason, "cancelled");
  lease.release();
  assert.equal(observedPhase, undefined);
  unsubscribe();
  manager.stop();
});

test("manual text work is not released by pressure until its compute lease ends", async () => {
  const manager = new AiModelManager(
    "unused-test-directory",
    new FakeGameDetection() as never,
    async () => undefined,
  );
  const releases: string[] = [];
  let statusUpdates = 0;
  const unsubscribe = manager.onQwenReleaseRequested((reason) => releases.push(reason));
  const unsubscribeStatus = manager.onStatus(() => {
    statusUpdates += 1;
  });
  const lease = await manager.acquireComputeSlot("summary", true);
  const pressure = {
    inVoiceRoom: true,
    recordingActive: false,
    screenSharing: false,
    peerRecovering: true,
    latencyMs: 0,
    packetLossPercent: 0,
    rendererMemoryPressure: false,
    updatedAt: Date.now(),
  };
  manager.updateRuntimePressure(pressure);
  assert.equal(lease.signal.aborted, false);
  assert.deepEqual(releases, []);
  const updatesAfterTransition = statusUpdates;
  manager.updateRuntimePressure({ ...pressure, updatedAt: Date.now() + 1 });
  assert.equal(statusUpdates, updatesAfterTransition);
  lease.release();
  assert.deepEqual(releases, ["peer_recovery"]);
  unsubscribe();
  unsubscribeStatus();
  manager.stop();
});

test("game start waits for a running manual text job before releasing Qwen", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-game-manual-"));
  const games = new FakeGameDetection();
  const manager = new AiModelManager(directory, games as never, async () => undefined);
  try {
    await manager.initialize("after_game");
    const releases: string[] = [];
    manager.onQwenReleaseRequested((reason) => releases.push(reason));
    const lease = await manager.acquireComputeSlot("summary", true);
    games.setGame("running game");
    assert.equal(lease.signal.aborted, false);
    assert.deepEqual(releases, []);
    lease.release();
    assert.deepEqual(releases, ["processing_deferred"]);
  } finally {
    manager.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("AI model manager releases its game listener when stopped or reinitialized", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-listener-"));
  const games = new FakeGameDetection();
  const manager = new AiModelManager(directory, games as never, async () => undefined);
  try {
    await manager.initialize("manual");
    games.setGame("first game");
    assert.equal(manager.getSnapshot().scheduler.gameActive, true);
    await manager.initialize("manual");
    games.setGame("second game");
    assert.equal(manager.getSnapshot().scheduler.gameActive, true);
    manager.stop();
    games.setGame(undefined);
    assert.equal(manager.getSnapshot().scheduler.gameActive, true);
  } finally {
    manager.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("stopping during model initialization prevents a late listener or download", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-stopped-init-"));
  let subscribed = 0;
  const games = {
    getSnapshot: () => ({ gameName: undefined }),
    onDetected: () => {
      subscribed += 1;
      return () => undefined;
    },
  };
  const manager = new AiModelManager(directory, games as never, async () => undefined);
  let releaseRead: (() => void) | undefined;
  let startedRead: (() => void) | undefined;
  const readStarted = new Promise<void>((resolve) => {
    startedRead = resolve;
  });
  const readBlocked = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const internal = manager as unknown as { readState: () => Promise<unknown> };
  internal.readState = async () => {
    startedRead?.();
    await readBlocked;
    return { models: {}, taskCheckpoints: {} };
  };
  try {
    const initializing = manager.initialize("manual");
    await readStarted;
    manager.stop();
    releaseRead?.();
    await initializing;
    assert.equal(subscribed, 0);
    assert.equal(
      manager.getSnapshot().models.every((model) => model.phase === "not_installed"),
      true,
    );
  } finally {
    releaseRead?.();
    manager.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("deleting one recording clears only its AI checkpoints", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-checkpoints-"));
  const manager = new AiModelManager(
    directory,
    new FakeGameDetection() as never,
    async () => undefined,
  );
  try {
    await manager.initialize("manual");
    for (const [taskId, recordingId] of [
      ["transcription:one:model-a", "one"],
      ["transcription:one:model-b", "one"],
      ["transcription:two:model-a", "two"],
    ]) {
      await manager.saveTaskCheckpoint({
        taskId,
        recordingId,
        kind: "transcription",
        completedUnits: 1,
        totalUnits: 2,
        updatedAt: new Date().toISOString(),
      });
    }
    await manager.clearTaskCheckpointsForRecording("one");
    assert.equal(manager.getTaskCheckpoint("transcription:one:model-a"), undefined);
    assert.equal(manager.getTaskCheckpoint("transcription:one:model-b"), undefined);
    assert.equal(manager.getTaskCheckpoint("transcription:two:model-a")?.recordingId, "two");
  } finally {
    manager.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("deleting a model waits for its active repair before removing state", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-repair-delete-"));
  const manager = new AiModelManager(
    directory,
    new FakeGameDetection() as never,
    async () => undefined,
  );
  let releaseRepair: (() => void) | undefined;
  let repairStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    repairStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releaseRepair = resolve;
  });
  try {
    await manager.initialize("manual");
    const internal = manager as unknown as {
      persisted: {
        models: Record<string, { userInstalled: boolean; activeRevision?: string; phase: string }>;
      };
    };
    internal.persisted.models["fun-asr-nano-2512"] = {
      userInstalled: true,
      activeRevision: "test-revision",
      phase: "installed",
    };
    manager.setRuntimePreparer(async () => {
      repairStarted?.();
      await blocked;
      return { ready: true };
    });
    const repairing = manager.controlModel("fun-asr-nano-2512", "repair");
    await started;
    let deletionFinished = false;
    const deleting = manager.controlModel("fun-asr-nano-2512", "delete").then(() => {
      deletionFinished = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(deletionFinished, false);
    releaseRepair?.();
    await Promise.all([repairing, deleting]);
    assert.equal(
      manager.getSnapshot().models.find((model) => model.id === "fun-asr-nano-2512")?.phase,
      "not_installed",
    );
  } finally {
    releaseRepair?.();
    manager.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a late pinned-revision check cannot restart a deleted model download", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-pinned-delete-"));
  const manager = new AiModelManager(
    directory,
    new FakeGameDetection() as never,
    async () => undefined,
  );
  await manager.initialize("manual");
  let releasePersist: (() => void) | undefined;
  let persistStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    persistStarted = resolve;
  });
  const blocked = new Promise<void>((resolve) => {
    releasePersist = resolve;
  });
  const internal = manager as unknown as {
    persisted: {
      models: Record<string, { userInstalled: boolean; activeRevision?: string; phase: string }>;
    };
    persist: () => Promise<void>;
    ensurePinnedRevision: (id: "fun-asr-nano-2512", generation: number) => Promise<void>;
    startDownload: () => void;
    lifecycleGeneration: number;
  };
  internal.persisted.models["fun-asr-nano-2512"] = {
    userInstalled: true,
    activeRevision: "old-revision",
    phase: "installed",
  };
  let persistCalls = 0;
  internal.persist = async () => {
    persistCalls += 1;
    if (persistCalls === 1) {
      persistStarted?.();
      await blocked;
    }
  };
  let downloadsStarted = 0;
  internal.startDownload = () => {
    downloadsStarted += 1;
  };
  try {
    const checking = internal.ensurePinnedRevision(
      "fun-asr-nano-2512",
      internal.lifecycleGeneration,
    );
    await started;
    await manager.controlModel("fun-asr-nano-2512", "delete");
    releasePersist?.();
    await checking;
    assert.equal(downloadsStarted, 0);
  } finally {
    releasePersist?.();
    manager.stop();
    await rm(directory, { recursive: true, force: true });
  }
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

test("a cancelled runtime preparation is not converted into a model-ready result", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-runtime-cancel-"));
  const manager = new AiModelManager(
    directory,
    new FakeGameDetection() as never,
    async () => undefined,
  );
  await manager.initialize("manual");
  const controller = new AbortController();
  manager.setRuntimePreparer(async (_id, signal) => {
    assert.equal(signal, controller.signal);
    controller.abort();
    throw new Error("ai_task_paused");
  });
  const internal = manager as unknown as {
    prepareRuntime: (id: AiModelId, signal?: AbortSignal) => Promise<{ ready: boolean }>;
  };
  try {
    await assert.rejects(
      internal.prepareRuntime("fun-asr-nano-2512", controller.signal),
      /ai_model_download_paused/,
    );
    assert.notEqual(
      manager.getSnapshot().models.find((model) => model.id === "fun-asr-nano-2512")?.runtimeReady,
      true,
    );
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
