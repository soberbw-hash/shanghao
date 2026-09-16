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
      type:"result", id:request.id, output:{text:String(request.durationMs)}
    }) + "\\n"), delay);
    end = buffer.indexOf("\\n");
  }
});
`;

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
