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
import {
  AiRuntimeManager,
  MOSS_RUNTIME_PACKAGES,
  FIRE_RED_RUNTIME_PACKAGES,
  QWEN_ORGANIZER_RUNTIME_PACKAGES,
  classifyCudaRuntimeFailure,
  providerCudaErrorCode,
  type PythonCudaDiagnostics,
} from "../src/main/ai-runtime-manager";

const healthyCudaDiagnostics = (
  overrides: Partial<PythonCudaDiagnostics> = {},
): PythonCudaDiagnostics => ({
  pythonPath: "C:\\ShangHao\\AI\\runtimes\\python\\Scripts\\python.exe",
  torchLocation: "C:\\ShangHao\\AI\\runtimes\\cuda-python\\torch\\__init__.py",
  torchVersion: "2.11.0+cu128",
  torchCudaVersion: "12.8",
  cudaAvailable: true,
  deviceCount: 1,
  gpuNames: ["Test NVIDIA GPU"],
  computeCapabilities: ["8.9"],
  bf16Supported: true,
  fp16Supported: true,
  totalVramBytes: 8 * 1024 ** 3,
  torchDlls: ["c10_cuda.dll", "cudart64_12.dll", "torch_cuda.dll"],
  dllLoadFailures: [],
  nvidiaSmiAvailable: true,
  nvidiaDriverVersion: "610.62",
  ...overrides,
});

test("shared CUDA self-check classifies actionable Runtime failures", () => {
  assert.equal(classifyCudaRuntimeFailure(healthyCudaDiagnostics()), undefined);
  assert.equal(
    classifyCudaRuntimeFailure(
      healthyCudaDiagnostics({
        cudaAvailable: false,
        deviceCount: 0,
        error: "ai_runtime_spawn_failed: spawn EPERM",
      }),
    ),
    "python_start_failed",
  );
  assert.equal(
    classifyCudaRuntimeFailure(
      healthyCudaDiagnostics({ torchVersion: "2.11.0+cpu", torchCudaVersion: undefined }),
    ),
    "cpu_only_pytorch",
  );
  assert.equal(
    classifyCudaRuntimeFailure(
      healthyCudaDiagnostics({ dllLoadFailures: ["torch_cuda.dll: WinError 126"] }),
    ),
    "cuda_dll_load_failed",
  );
  assert.equal(
    classifyCudaRuntimeFailure(
      healthyCudaDiagnostics({
        cudaAvailable: false,
        deviceCount: 0,
        gpuNames: [],
        computeCapabilities: [],
        bf16Supported: false,
        fp16Supported: false,
        nvidiaSmiAvailable: false,
        nvidiaSmiError: "nvidia-smi was not found",
      }),
    ),
    "nvidia_driver_error",
  );
  assert.equal(
    classifyCudaRuntimeFailure(
      healthyCudaDiagnostics({
        cudaAvailable: false,
        deviceCount: 0,
        gpuNames: [],
        computeCapabilities: [],
        bf16Supported: false,
        fp16Supported: false,
      }),
    ),
    "gpu_not_detected",
  );
  assert.equal(
    classifyCudaRuntimeFailure(healthyCudaDiagnostics({ bf16Supported: false })),
    "bf16_unsupported",
  );
});

test("all GPU providers expose the exact common preflight error codes", () => {
  assert.equal(providerCudaErrorCode("qwen3-asr-0.6b-force"), "qwen3_asr_cuda_required");
  assert.equal(providerCudaErrorCode("qwen3-asr-1.7b-force", true), "qwen3_asr_cuda_bf16_required");
  assert.equal(
    providerCudaErrorCode("fun-asr-nano-2512", true),
    "fun_asr_nano_2512_cuda_bf16_required",
  );
  assert.equal(providerCudaErrorCode("glm-asr-nano-2512"), "glm_asr_nano_2512_cuda_required");
  assert.equal(providerCudaErrorCode("fireredasr2-aed"), "fireredasr2_aed_cuda_required");
  assert.equal(
    providerCudaErrorCode("moss-transcribe-diarize-0.9b", true),
    "moss_transcribe_diarize_cuda_bf16_required",
  );
  assert.equal(
    providerCudaErrorCode("dolphin-cn-dialect-0.4b"),
    "dolphin_cn_dialect_cuda_required",
  );
  assert.equal(
    providerCudaErrorCode("cohere-transcribe-2b", true),
    "cohere_transcribe_cuda_bf16_required",
  );
});

test("FireRed runtime keeps the native fbank dependency required by official source", () => {
  assert.deepEqual(FIRE_RED_RUNTIME_PACKAGES, [
    "https://github.com/FireRedTeam/FireRedASR2S/archive/4e7d9aaf4482a47cec1724807026b9b151926eb5.zip",
    "kaldi-native-fbank==1.22.3",
  ]);
});

test("MOSS runtime pins the official parser and inference source", () => {
  assert.equal(
    MOSS_RUNTIME_PACKAGES[0],
    "https://github.com/OpenMOSS/MOSS-Transcribe-Diarize/archive/0e3d1403fd8f1f1c674e883ece96b9f630794ebe.zip",
  );
});

test("Qwen organizer reuses shared CUDA torch and pins only its provider dependencies", () => {
  assert.deepEqual(QWEN_ORGANIZER_RUNTIME_PACKAGES, [
    "transformers==5.15.0",
    "accelerate>=1.10,<2",
  ]);
});

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
  const runtime = new AiRuntimeManager(
    runtimeRoot,
    {
      model: (id) =>
        id === "qwen3-asr-0.6b-force"
          ? modelRoot
          : id === "qwen3-forced-aligner-0.6b" && alignerAvailable
            ? alignerRoot
            : undefined,
      qwen: () => undefined,
      activeAsr: () => "qwen3-asr-0.6b-force",
    },
    {
      probeCuda: async () => ({
        ...healthyCudaDiagnostics(),
        pythonPath: pythonExecutable,
      }),
    },
  );
  try {
    const missing = await runtime.status();
    assert.equal(missing.asr.ready, false);
    assert.equal(missing.asr.errorCode, "model_missing");
    assert.match(missing.asr.message ?? "", /ForcedAligner/);
    await mkdir(alignerRoot, { recursive: true });
    await writeFile(path.join(alignerRoot, "config.json"), "{}", "utf8");
    alignerAvailable = true;
    const ready = await runtime.status();
    assert.equal(ready.asr.ready, true);
    assert.equal((await runtime.modelRuntimeStatuses())["qwen3-forced-aligner-0.6b"].ready, true);
  } finally {
    runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime status recognizes official Fun-ASR and FireRed file structures", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-layout-health-"));
  const runtimeRoot = path.join(directory, "runtimes");
  const funRoot = path.join(directory, "fun");
  const fireRedRoot = path.join(directory, "firered");
  const pythonExecutable = path.join(runtimeRoot, "python", "Scripts", "python.exe");
  await Promise.all([
    mkdir(path.dirname(pythonExecutable), { recursive: true }),
    mkdir(path.join(runtimeRoot, "asr-python", "funasr", "funasr"), { recursive: true }),
    mkdir(path.join(runtimeRoot, "asr-python", "firered", "fireredasr2s"), { recursive: true }),
    mkdir(path.join(runtimeRoot, "asr-python", "firered", "kaldi_native_fbank"), {
      recursive: true,
    }),
    mkdir(funRoot, { recursive: true }),
    mkdir(fireRedRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(pythonExecutable, "runtime"),
    writeFile(path.join(runtimeRoot, "asr-runner.py"), "print('runner')"),
    writeFile(path.join(runtimeRoot, "asr-python", "funasr", "funasr", "__init__.py"), ""),
    writeFile(path.join(runtimeRoot, "asr-python", "firered", "fireredasr2s", "__init__.py"), ""),
    writeFile(
      path.join(runtimeRoot, "asr-python", "firered", "kaldi_native_fbank", "__init__.py"),
      "",
    ),
    ...["model.pt", "config.yaml", "configuration.json", "multilingual.tiktoken"].map((name) =>
      writeFile(path.join(funRoot, name), name.endsWith(".json") ? "{}" : "data"),
    ),
    ...["model.pth.tar", "config.yaml", "cmvn.ark", "dict.txt", "train_bpe1000.model"].map((name) =>
      writeFile(path.join(fireRedRoot, name), "data"),
    ),
  ]);
  const runtime = new AiRuntimeManager(
    runtimeRoot,
    {
      model: (id) =>
        id === "fun-asr-nano-2512" ? funRoot : id === "fireredasr2-aed" ? fireRedRoot : undefined,
      qwen: () => undefined,
      activeAsr: () => "fun-asr-nano-2512",
    },
    {
      probeCuda: async () => ({
        ...healthyCudaDiagnostics(),
        pythonPath: pythonExecutable,
      }),
    },
  );
  try {
    assert.equal((await runtime.status("fun-asr-nano-2512")).asr.ready, true);
    assert.equal((await runtime.status("fireredasr2-aed")).asr.ready, true);
  } finally {
    runtime.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
