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
