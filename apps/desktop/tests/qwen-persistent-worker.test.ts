import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { QwenPersistentWorker } from "../src/main/qwen-persistent-worker";

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
    const send = () => process.stdout.write(JSON.stringify({
      type:"result", id:request.id, output:JSON.stringify({echo:request.prompt})
    }) + "\\n");
    if (request.prompt === "slow") setTimeout(send, 10_000);
    else if (request.prompt === "idle-overlap") setTimeout(send, 180);
    else setTimeout(send, 10);
    end = buffer.indexOf("\\n");
  }
});
`;

test("Qwen worker loads once, serializes jobs and exposes real process health", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-qwen-worker-"));
  const runner = path.join(directory, "fake-worker.cjs");
  await writeFile(runner, fakeWorkerSource, "utf8");
  const worker = new QwenPersistentWorker(process.execPath, runner, () => directory);
  try {
    const first = JSON.parse(
      await worker.run({
        prompt: "第一条",
        maxNewTokens: 32,
        resourceMode: "low",
        timeoutMs: 5_000,
      }),
    ) as { echo: string };
    const processId = worker.health().processId;
    const second = JSON.parse(
      await worker.run({
        prompt: "second",
        maxNewTokens: 32,
        resourceMode: "normal",
        timeoutMs: 5_000,
      }),
    ) as { echo: string };
    assert.equal(first.echo, "第一条");
    assert.equal(second.echo, "second");
    assert.equal(worker.health().loaded, true);
    assert.equal(worker.health().processId, processId);
  } finally {
    worker.release("test_complete");
    await rm(directory, { recursive: true, force: true });
  }
});

test("Qwen worker cancellation terminates the active process and recovers the next run", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-qwen-cancel-"));
  const runner = path.join(directory, "fake-worker.cjs");
  await writeFile(runner, fakeWorkerSource, "utf8");
  const worker = new QwenPersistentWorker(process.execPath, runner, () => directory);
  try {
    const controller = new AbortController();
    const slow = worker.run({
      prompt: "slow",
      maxNewTokens: 32,
      resourceMode: "low",
      timeoutMs: 20_000,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    await assert.rejects(slow, /ai_task_paused/);
    const recovered = JSON.parse(
      await worker.run({
        prompt: "recovered",
        maxNewTokens: 32,
        resourceMode: "low",
        timeoutMs: 5_000,
      }),
    ) as { echo: string };
    assert.equal(recovered.echo, "recovered");
  } finally {
    worker.release("test_complete");
    await rm(directory, { recursive: true, force: true });
  }
});

test("Qwen idle cleanup never terminates a newly active request", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-qwen-idle-"));
  const runner = path.join(directory, "fake-worker.cjs");
  await writeFile(runner, fakeWorkerSource, "utf8");
  const worker = new QwenPersistentWorker(
    process.execPath,
    runner,
    () => directory,
    undefined,
    100,
  );
  try {
    await worker.run({
      prompt: "first",
      maxNewTokens: 32,
      resourceMode: "low",
      timeoutMs: 2_000,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    const output = await worker.run({
      prompt: "idle-overlap",
      maxNewTokens: 32,
      resourceMode: "low",
      timeoutMs: 2_000,
    });
    assert.equal(JSON.parse(output).echo, "idle-overlap");
  } finally {
    worker.release("test_complete");
    await rm(directory, { recursive: true, force: true });
  }
});
