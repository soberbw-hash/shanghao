import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AsrPersistentWorker } from "../src/main/asr-persistent-worker";

const fakeWorkerSource = `
process.stdout.write(JSON.stringify({type:"loading"}) + "\\n");
setTimeout(() => process.stdout.write(JSON.stringify({type:"ready"}) + "\\n"), 10);
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let end = buffer.indexOf("\\n");
  while (end >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    const request = JSON.parse(line);
    const delay = request.durationMs > 1_000 ? 180 : 10;
    setTimeout(() => process.stdout.write(JSON.stringify({
      type:"result", id:request.id, output:{text:String(request.durationMs),rawText:request.context}
    }) + "\\n"), delay);
    end = buffer.indexOf("\\n");
  }
});
`;

test("successive requests on the same worker never inherit another request's context", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-asr-context-"));
  const runner = path.join(directory, "worker.cjs");
  await writeFile(runner, fakeWorkerSource, "utf8");
  const worker = new AsrPersistentWorker(process.execPath, runner);
  const run = (context?: string) =>
    worker.run({
      launch: { modelId: "qwen3-asr-0.6b-force", modelPath: directory },
      wavPath: "synthetic.wav",
      durationMs: 100,
      resourceMode: "low",
      timeoutMs: 2000,
      context,
    });
  try {
    assert.equal((await run("游戏甲")).rawText, "游戏甲");
    const pid = worker.health().processId;
    assert.equal((await run("游戏乙")).rawText, "游戏乙");
    assert.equal((await run()).rawText, "");
    assert.equal(worker.health().processId, pid);
    await assert.rejects(run("x".repeat(513)), /invalid_asr_context/);
  } finally {
    await worker.releaseAndWait("test_complete");
    await rm(directory, { recursive: true, force: true });
  }
});

test("ASR abort before/during/after request and timeout race leave worker reusable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-asr-abort-"));
  const runner = path.join(directory, "worker.cjs");
  await writeFile(runner, fakeWorkerSource, "utf8");
  const worker = new AsrPersistentWorker(process.execPath, runner);
  const request = (signal?: AbortSignal, durationMs = 100, timeoutMs = 2000) =>
    worker.run({
      launch: { modelId: "fun-asr-nano-2512", modelPath: directory },
      wavPath: "test.wav",
      resourceMode: "low",
      durationMs,
      timeoutMs,
      signal,
    });
  try {
    const before = new AbortController();
    before.abort();
    await assert.rejects(request(before.signal), /paused/);
    assert.equal(worker.health().processId, undefined);
    const after = new AbortController();
    await request(after.signal);
    const pid = worker.health().processId;
    after.abort();
    await request();
    assert.equal(worker.health().processId, pid);
    const during = new AbortController();
    const running = request(during.signal, 2000);
    setTimeout(() => during.abort(), 30);
    await assert.rejects(running, /paused/);
    await request();
    const race = new AbortController();
    const timed = request(race.signal, 2000, 20);
    setTimeout(() => race.abort(), 20);
    await assert.rejects(timed, /paused|timeout/);
    await request();
    assert.equal(worker.health().activeJobId, undefined);
    assert.equal(worker.health().queuedJobs, 0);
  } finally {
    await worker.releaseAndWait("test_complete");
    await rm(directory, { recursive: true, force: true });
  }
});

test("ASR idle cleanup never terminates the next model comparison job", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-asr-worker-"));
  const runner = path.join(directory, "fake-worker.cjs");
  await writeFile(runner, fakeWorkerSource, "utf8");
  const worker = new AsrPersistentWorker(process.execPath, runner, 100);
  const launch = (modelId: "fun-asr-nano-2512" | "glm-asr-nano-2512") => ({
    modelId,
    modelPath: path.join(directory, modelId),
  });
  try {
    const first = await worker.run({
      launch: launch("fun-asr-nano-2512"),
      wavPath: "first.wav",
      durationMs: 100,
      resourceMode: "low",
      timeoutMs: 2_000,
    });
    assert.equal(first.text, "100");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    const second = await worker.run({
      launch: launch("glm-asr-nano-2512"),
      wavPath: "second.wav",
      durationMs: 2_000,
      resourceMode: "low",
      timeoutMs: 2_000,
    });
    assert.equal(second.text, "2000");
  } finally {
    worker.release("test_complete");
    await rm(directory, { recursive: true, force: true });
  }
});

test("same model with a different Python environment replaces the old worker", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-asr-env-"));
  const runner = path.join(directory, "worker.cjs");
  await writeFile(runner, fakeWorkerSource, "utf8");
  const worker = new AsrPersistentWorker(process.execPath, runner);
  const run = (pythonPath: string) =>
    worker.run({
      launch: { modelId: "fun-asr-nano-2512", modelPath: directory, pythonPath },
      wavPath: "test.wav",
      resourceMode: "low",
      durationMs: 100,
      timeoutMs: 2000,
    });
  try {
    await run(path.join(directory, "env-a"));
    const firstPid = worker.health().processId;
    await run(path.join(directory, "env-a"));
    assert.equal(worker.health().processId, firstPid);
    await run(path.join(directory, "env-b"));
    assert.notEqual(worker.health().processId, firstPid);
  } finally {
    await worker.releaseAndWait("test_complete");
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancelling the loading request does not drop the next queued model", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-asr-load-cancel-"));
  const runner = path.join(directory, "worker.cjs");
  await writeFile(
    runner,
    fakeWorkerSource.replace('"ready"}) + "\\n"), 10)', '"ready"}) + "\\n"), 200)'),
    "utf8",
  );
  const worker = new AsrPersistentWorker(process.execPath, runner);
  const controller = new AbortController();
  const run = (modelId: "fun-asr-nano-2512" | "glm-asr-nano-2512", signal?: AbortSignal) =>
    worker.run({
      launch: { modelId, modelPath: directory },
      wavPath: "test.wav",
      resourceMode: "low",
      durationMs: 100,
      timeoutMs: 3000,
      signal,
    });
  try {
    const first = run("fun-asr-nano-2512", controller.signal);
    const rejected = assert.rejects(first, /paused/);
    const second = run("glm-asr-nano-2512");
    setTimeout(() => controller.abort(), 50);
    await rejected;
    assert.equal((await second).text, "100");
    assert.equal(worker.health().modelId, "glm-asr-nano-2512");
    assert.equal(worker.health().queuedJobs, 0);
  } finally {
    await worker.releaseAndWait("test_complete");
    await rm(directory, { recursive: true, force: true });
  }
});

test("release before worker spawn cannot leave a late child behind", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-asr-release-"));
  const runner = path.join(directory, "worker.cjs");
  await writeFile(runner, fakeWorkerSource, "utf8");
  const worker = new AsrPersistentWorker(process.execPath, runner);
  try {
    const pending = worker.run({
      launch: { modelId: "fun-asr-nano-2512", modelPath: directory },
      wavPath: "test.wav",
      resourceMode: "low",
      durationMs: 100,
      timeoutMs: 2000,
    });
    const rejected = assert.rejects(pending, /paused/);
    await worker.releaseAndWait("test_complete");
    await rejected;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    assert.equal(worker.health().processId, undefined);
    assert.equal(worker.health().queuedJobs, 0);
  } finally {
    await worker.releaseAndWait("test_complete");
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent requests for different models keep their own worker identity", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-asr-queue-"));
  const runner = path.join(directory, "worker.cjs");
  const source = fakeWorkerSource.replace(
    "text:String(request.durationMs)",
    'text:process.argv[process.argv.indexOf("--provider")+1]',
  );
  await writeFile(runner, source, "utf8");
  const worker = new AsrPersistentWorker(process.execPath, runner);
  const run = (modelId: "fun-asr-nano-2512" | "glm-asr-nano-2512") =>
    worker.run({
      launch: { modelId, modelPath: directory },
      wavPath: "test.wav",
      resourceMode: "low",
      durationMs: 100,
      timeoutMs: 3000,
    });
  try {
    const [first, second] = await Promise.all([run("fun-asr-nano-2512"), run("glm-asr-nano-2512")]);
    assert.equal(first.text, "fun-asr-nano-2512");
    assert.equal(second.text, "glm-asr-nano-2512");
  } finally {
    await worker.releaseAndWait("test_complete");
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancelling a loading model stops its child without waiting for readiness", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-asr-load-stop-"));
  const runner = path.join(directory, "worker.cjs");
  await writeFile(
    runner,
    fakeWorkerSource.replace('"ready"}) + "\\n"), 10)', '"ready"}) + "\\n"), 5000)'),
    "utf8",
  );
  const worker = new AsrPersistentWorker(process.execPath, runner);
  const controller = new AbortController();
  try {
    const pending = worker.run({
      launch: { modelId: "fun-asr-nano-2512", modelPath: directory },
      wavPath: "test.wav",
      resourceMode: "low",
      durationMs: 100,
      timeoutMs: 7000,
      signal: controller.signal,
    });
    const rejected = assert.rejects(pending, /paused/);
    for (let i = 0; i < 100 && !worker.health().processId; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(worker.health().processId);
    controller.abort();
    await rejected;
    assert.equal(worker.health().processId, undefined);
  } finally {
    await worker.releaseAndWait("test_complete");
    await rm(directory, { recursive: true, force: true });
  }
});
