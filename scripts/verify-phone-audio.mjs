// Explicit integration check. Briefly mutes real Windows endpoints; never run in CI.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { once } from "node:events";
const directory = mkdtempSync(path.join(tmpdir(), "shanghao-phone-check-"));
const journal = path.join(directory, "recovery.json");
const executable = path.resolve(
  process.argv[2] ?? "apps/desktop/resources/native/ShangHao.PhoneAudio.exe",
);
let sequence = 0;
function launch(extra = []) {
  const child = spawn(executable, [journal, ...extra], { windowsHide: true });
  child.stderr.pipe(process.stderr);
  const responses = new Map();
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const lines = createInterface({ input: child.stdout });
  child.once("error", rejectReady);
  child.once("exit", (code) => {
    rejectReady(new Error(`Helper exited ${code}`));
    for (const { reject, timer } of responses.values()) {
      clearTimeout(timer);
      reject(new Error("Helper exited"));
    }
    responses.clear();
    lines.close();
  });
  lines.on("line", (line) => {
    const value = JSON.parse(line);
    if (value.ready) {
      if (value.error) rejectReady(new Error(value.error));
      else resolveReady();
      return;
    }
    const pending = responses.get(value.id);
    if (!pending) return;
    responses.delete(value.id);
    clearTimeout(pending.timer);
    if (value.error) pending.reject(new Error(value.error));
    else pending.resolve(value);
  });
  const request = async (payload) => {
    await ready;
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        responses.delete(id);
        reject(new Error("Helper timeout"));
      }, 10000);
      responses.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, ...payload }) + "\n");
    });
  };
  const close = async () => {
    const exited = child.exitCode === null ? once(child, "exit") : Promise.resolve();
    child.stdin.end();
    await exited;
  };
  return { request, close };
}
let runner = launch();
let before;
const activationMs = [];
try {
  before = await runner.request({ inspect: true });
  assert.ok(
    before.endpoints.some((value) => value.flow === 0),
    "requires render endpoint",
  );
  assert.ok(
    before.endpoints.some((value) => value.flow === 1),
    "requires capture endpoint",
  );
  for (let iteration = 0; iteration < 20; iteration++) {
    const started = performance.now();
    await runner.request({ active: true });
    activationMs.push(performance.now() - started);
    const during = await runner.request({ inspect: true });
    assert.ok(during.endpoints.every((value) => value.muted));
    assert.deepEqual(
      during.endpoints.map((value) => [value.id, value.level]),
      before.endpoints.map((value) => [value.id, value.level]),
    );
    await runner.request({ active: false });
    assert.deepEqual((await runner.request({ inspect: true })).endpoints, before.endpoints);
  }
  await runner.request({ active: true });
  await runner.close(); // Parent loss must NOT unexpectedly reopen microphones.
  assert.ok(JSON.parse(readFileSync(journal, "utf8")).length > 0);
  runner = launch(["--keep-muted"]);
  assert.ok((await runner.request({ inspect: true })).endpoints.every((value) => value.muted));
  await runner.request({ active: false });
  assert.deepEqual((await runner.request({ inspect: true })).endpoints, before.endpoints);
  console.log(
    JSON.stringify({
      cycles: 20,
      inputs: before.endpoints.filter((value) => value.flow === 1).length,
      outputs: before.endpoints.filter((value) => value.flow === 0).length,
      allMuted: true,
      volumeUnchanged: true,
      exactStateRestored: true,
      parentLossKeptMuted: true,
      restartKeptMuted: true,
      activationMaxMs: Math.round(Math.max(...activationMs)),
    }),
  );
} finally {
  // Explicit restore even when a test assertion fails.
  try {
    await runner.request({ active: false });
  } finally {
    await runner.close();
  }
}
