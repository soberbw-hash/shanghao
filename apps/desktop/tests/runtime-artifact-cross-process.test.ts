import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workerPath = fileURLToPath(new URL("./runtime-artifact-download-worker.ts", import.meta.url));
const timeout = (ms: number, message: string): Promise<never> =>
  new Promise((_resolve, reject) => {
    setTimeout(() => reject(new Error(message)), ms).unref();
  });

test("two processes downloading the same runtime preserve one verified artifact", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-runtime-processes-"));
  const destination = path.join(directory, "runtime.whl");
  const workers: ChildProcess[] = [];
  try {
    const start = () => {
      const child = fork(workerPath, [destination], {
        cwd: path.dirname(workerPath),
        execArgv: ["--import", "tsx"],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      workers.push(child);
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const ready = new Promise<void>((resolve, reject) => {
        child.on("message", (message: { type?: string }) => {
          if (message.type === "ready") resolve();
        });
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code !== 0) reject(new Error(`worker_exited_early_${code}:${stderr}`));
        });
      });
      const result = new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
        child.on("message", (message: { type?: string; ok?: boolean; error?: string }) => {
          if (message.type === "result") resolve({ ok: message.ok === true, error: message.error });
        });
        child.once("error", reject);
      });
      return { child, ready, result };
    };
    const first = start();
    const second = start();
    await Promise.race([
      Promise.all([first.ready, second.ready]),
      timeout(10_000, "runtime_workers_not_ready"),
    ]);
    first.child.send({ type: "go" });
    second.child.send({ type: "go" });
    const results = await Promise.race([
      Promise.all([first.result, second.result]),
      timeout(15_000, "runtime_workers_did_not_finish"),
    ]);
    assert.deepEqual(results, [
      { ok: true, error: undefined },
      { ok: true, error: undefined },
    ]);
    const bytes = await readFile(destination);
    assert.equal(bytes.length, 1024 * 1024);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      createHash("sha256")
        .update(Buffer.alloc(1024 * 1024, 0x61))
        .digest("hex"),
    );
    assert.deepEqual(await readdir(directory), ["runtime.whl"]);
  } finally {
    for (const worker of workers) if (worker.exitCode === null) worker.kill();
    await rm(directory, { recursive: true, force: true });
  }
});
