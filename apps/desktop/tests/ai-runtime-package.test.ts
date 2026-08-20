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
  assert.equal(manifest.vibevoice.source, "microsoft/VibeASR.cpp");
  assert.match(manifest.vibevoice.revision, /^[a-f0-9]{40}$/);
  assert.ok(manifest.vibevoice.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.match(manifest.qwen.runner.sha256, /^[a-f0-9]{64}$/);
});

test("runtime health distinguishes a missing native DLL from a missing model", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-health-"));
  const runtimeRoot = path.join(directory, "runtimes");
  const modelRoot = path.join(directory, "model");
  const executable = path.join(runtimeRoot, "VibeASR.cpp", "build", "bin", "asr_infer.exe");
  const dllRoot = path.join(runtimeRoot, "mingw64", "bin");
  await mkdir(path.dirname(executable), { recursive: true });
  await mkdir(dllRoot, { recursive: true });
  await mkdir(modelRoot, { recursive: true });
  await Promise.all([
    writeFile(executable, "runtime"),
    writeFile(path.join(modelRoot, "vibeasr-vae-encoder-i8_s.gguf"), "model"),
    writeFile(path.join(modelRoot, "vibeasr-lm-i2_s-embed-q6_k.gguf"), "model"),
    ...["libgcc_s_seh-1.dll", "libstdc++-6.dll", "libwinpthread-1.dll", "libgomp-1.dll"].map(
      (name) => writeFile(path.join(dllRoot, name), "dll"),
    ),
  ]);
  const runtime = new AiRuntimeManager(runtimeRoot, {
    vibevoice: () => modelRoot,
    qwen: () => undefined,
  });
  try {
    assert.equal((await runtime.status()).vibevoice.ready, true);
    await rm(path.join(dllRoot, "libgomp-1.dll"), { force: true });
    const status = await runtime.status();
    assert.equal(status.vibevoice.ready, false);
    assert.equal(status.vibevoice.errorCode, "dll_missing");
    assert.match(status.vibevoice.message ?? "", /libgomp-1\.dll/);
  } finally {
    runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
