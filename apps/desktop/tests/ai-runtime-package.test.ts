import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  prepareBundledAiRuntime,
  sha256File,
  verifyVibeVoiceRuntimePackage,
  type AiRuntimePackageManifest,
} from "../src/main/ai-runtime-package";
import { AiRuntimeManager } from "../src/main/ai-runtime-manager";

test("bundled AI runtime copies only manifest-verified files into persistent storage", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-runtime-"));
  const bundledRoot = path.join(directory, "bundled");
  const runtimeRoot = path.join(directory, "runtime");
  const vibeFile = path.join(bundledRoot, "vibevoice", "asr_infer.exe");
  const runnerFile = path.join(bundledRoot, "qwen-runner.py");
  await mkdir(path.dirname(vibeFile), { recursive: true });
  await writeFile(vibeFile, "pinned-native-runtime", "utf8");
  await writeFile(runnerFile, "print('worker')", "utf8");
  const manifest: AiRuntimePackageManifest = {
    schemaVersion: 1,
    packageVersion: "test",
    platform: "win32-x64",
    vibevoice: {
      source: "microsoft/VibeASR.cpp",
      revision: "pinned",
      files: [{ path: "vibevoice/asr_infer.exe", sha256: await sha256File(vibeFile) }],
    },
    qwen: {
      pythonVersion: "3.12.10",
      torchVersion: "test",
      transformersVersion: "test",
      runner: { path: "qwen-runner.py", sha256: await sha256File(runnerFile) },
    },
  };
  await writeFile(
    path.join(bundledRoot, "runtime-manifest.json"),
    JSON.stringify(manifest),
    "utf8",
  );
  try {
    const installed = await prepareBundledAiRuntime({ bundledRoot, runtimeRoot });
    assert.equal(installed?.packageVersion, "test");
    assert.equal(
      await readFile(path.join(runtimeRoot, "vibevoice", "asr_infer.exe"), "utf8"),
      "pinned-native-runtime",
    );
    assert.equal((await verifyVibeVoiceRuntimePackage(runtimeRoot, manifest)).valid, true);
    await writeFile(path.join(runtimeRoot, "vibevoice", "asr_infer.exe"), "corrupt", "utf8");
    assert.deepEqual((await verifyVibeVoiceRuntimePackage(runtimeRoot, manifest)).corrupt, [
      "vibevoice/asr_infer.exe",
    ]);
    await prepareBundledAiRuntime({ bundledRoot, runtimeRoot });
    assert.equal((await verifyVibeVoiceRuntimePackage(runtimeRoot, manifest)).valid, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the checked-in runtime manifest pins source revisions and integrity hashes", async () => {
  const manifestPath = path.join(process.cwd(), "resources", "ai", "runtime-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as AiRuntimePackageManifest;
  const qwenRunnerPath = path.join(process.cwd(), "scripts", manifest.qwen.runner.path);
  assert.equal(manifest.vibevoice.source, "microsoft/VibeASR.cpp");
  assert.match(manifest.vibevoice.revision, /^[a-f0-9]{40}$/);
  assert.ok(manifest.vibevoice.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.match(manifest.qwen.runner.sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    manifest.qwen.runner.sha256,
    await sha256File(qwenRunnerPath),
    "qwen-runner.py changed without updating resources/ai/runtime-manifest.json",
  );
});

test("runtime health requires the shared Qwen aligner without duplicating it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-health-"));
  const runtimeRoot = path.join(directory, "runtimes");
  const modelRoot = path.join(directory, "model");
  const alignerRoot = path.join(directory, "aligner");
  const pythonExecutable = path.join(runtimeRoot, "python", "Scripts", "python.exe");
  const qwenPackage = path.join(runtimeRoot, "asr-python", "qwen", "qwen_asr", "__init__.py");
  await mkdir(path.dirname(pythonExecutable), { recursive: true });
  await mkdir(path.dirname(qwenPackage), { recursive: true });
  await mkdir(modelRoot, { recursive: true });
  await Promise.all([
    writeFile(pythonExecutable, "runtime"),
    writeFile(path.join(runtimeRoot, "asr-runner.py"), "print('runner')"),
    writeFile(qwenPackage, "# qwen-asr"),
    writeFile(path.join(modelRoot, "config.json"), "{}"),
  ]);
  let alignerAvailable = false;
  const runtime = new AiRuntimeManager(runtimeRoot, {
    model: (id) =>
      id === "qwen3-asr-0.6b-force"
        ? modelRoot
        : id === "qwen3-forced-aligner-0.6b" && alignerAvailable
          ? alignerRoot
          : undefined,
    qwen: () => undefined,
    activeAsr: () => "qwen3-asr-0.6b-force",
  });
  try {
    const missing = await runtime.status();
    assert.equal(missing.asr.ready, false);
    assert.equal(missing.asr.errorCode, "model_missing");
    assert.match(missing.asr.message ?? "", /ForcedAligner/);
    await mkdir(alignerRoot, { recursive: true });
    alignerAvailable = true;
    const ready = await runtime.status();
    assert.equal(ready.asr.ready, true);
    assert.equal((await runtime.modelRuntimeStatuses())["qwen3-forced-aligner-0.6b"].ready, true);
  } finally {
    runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
