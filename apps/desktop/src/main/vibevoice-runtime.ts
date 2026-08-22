import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  type LocalModelResourceUsage,
  type LocalModelRuntime,
  type LocalModelRuntimeHealth,
  type LocalModelRuntimePhase,
  type LocalModelRuntimeProgress,
} from "./local-model-runtime";
import { runLocalProcess, type LocalProcessResult } from "./local-process";

const REQUIRED_DLLS = [
  "libgcc_s_seh-1.dll",
  "libstdc++-6.dll",
  "libwinpthread-1.dll",
  "libgomp-1.dll",
] as const;

const exists = (filePath: string): Promise<boolean> =>
  access(filePath).then(
    () => true,
    () => false,
  );

export interface VibeVoiceRuntimeRequest {
  wavPath: string;
  durationMs: number;
  resourceMode: "low" | "normal";
  signal?: AbortSignal;
}

export const buildVibeVoiceArguments = (options: {
  modelPath: string;
  wavPath: string;
  resourceMode: "low" | "normal";
}): string[] => [
  "--vae-model",
  path.join(options.modelPath, "vibeasr-vae-encoder-i8_s.gguf"),
  "--lm-model",
  path.join(options.modelPath, "vibeasr-lm-i2_s-embed-q6_k.gguf"),
  "--audio",
  options.wavPath,
  // VibeASR.cpp's default sampling decoder is materially better for the
  // Chinese recordings used by ShangHao than the old greedy decoder.
  "-t",
  String(options.resourceMode === "low" ? 4 : Math.max(4, Math.min(8, os.cpus().length - 1))),
];

/** Pinned microsoft/VibeASR.cpp native runtime behind the common local-model lifecycle. */
export class VibeVoiceRuntime implements LocalModelRuntime<
  VibeVoiceRuntimeRequest,
  LocalProcessResult
> {
  private phase: LocalModelRuntimePhase = "stopped";
  private activeController?: AbortController;
  private lastError?: string;

  constructor(
    readonly executable: string,
    private readonly dependencyRoot: string,
    private readonly modelPath: () => string | undefined,
  ) {}

  prepare(): Promise<LocalModelRuntimeHealth> {
    return this.health();
  }

  async health(): Promise<LocalModelRuntimeHealth> {
    const model = this.modelPath();
    const modelReady = Boolean(
      model &&
      (await exists(path.join(model, "vibeasr-vae-encoder-i8_s.gguf"))) &&
      (await exists(path.join(model, "vibeasr-lm-i2_s-embed-q6_k.gguf"))),
    );
    const runtimeReady = await exists(this.executable);
    const missingDlls = (
      await Promise.all(
        REQUIRED_DLLS.map(async (fileName) => ({
          fileName,
          exists: await exists(path.join(this.dependencyRoot, fileName)),
        })),
      )
    )
      .filter((item) => !item.exists)
      .map((item) => item.fileName);
    const ready = modelReady && runtimeReady && missingDlls.length === 0;
    return {
      id: "vibevoice",
      phase: ready ? this.phase : "missing",
      ready,
      loaded: this.phase === "running",
      executable: ready ? this.executable : undefined,
      queuedJobs: 0,
      activeJobId: this.activeController ? "vibevoice-inference" : undefined,
      lastError: !modelReady
        ? "model_missing"
        : !runtimeReady
          ? "runtime_missing"
          : missingDlls.length
            ? "dll_missing"
            : undefined,
      detail:
        missingDlls.length > 0 ? `VibeVoice 缺少运行库：${missingDlls.join(", ")}` : this.lastError,
    };
  }

  async load(): Promise<void> {
    const health = await this.health();
    if (!health.ready) throw new Error(health.lastError ?? "vibevoice_runtime_unavailable");
    this.phase = "ready";
  }

  async run(request: VibeVoiceRuntimeRequest): Promise<LocalProcessResult> {
    await this.load();
    const model = this.modelPath();
    if (!model) throw new Error("model_vibevoice_not_installed");
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    request.signal?.addEventListener("abort", forwardAbort, { once: true });
    if (request.signal?.aborted) controller.abort();
    this.activeController?.abort();
    this.activeController = controller;
    this.phase = "running";
    this.lastError = undefined;
    try {
      return await runLocalProcess(
        this.executable,
        buildVibeVoiceArguments({
          modelPath: model,
          wavPath: request.wavPath,
          resourceMode: request.resourceMode,
        }),
        {
          signal: controller.signal,
          timeoutMs: Math.max(180_000, request.durationMs * 5),
          env: { ...process.env, PATH: `${this.dependencyRoot};${process.env.PATH ?? ""}` },
        },
      );
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.phase = controller.signal.aborted ? "paused" : "error";
      throw error;
    } finally {
      request.signal?.removeEventListener("abort", forwardAbort);
      if (this.activeController === controller) this.activeController = undefined;
      if (this.phase === "running") this.phase = "ready";
    }
  }

  cancel(): void {
    this.activeController?.abort();
  }

  progress(): LocalModelRuntimeProgress {
    return {
      phase: this.phase,
      completedUnits: this.phase === "ready" ? 1 : 0,
      totalUnits: 1,
      message: this.lastError,
    };
  }

  resourceUsage(): LocalModelResourceUsage {
    return {
      loaded: this.phase === "running",
      activeJobs: this.activeController ? 1 : 0,
      queuedJobs: 0,
    };
  }

  release(_reason?: string): void {
    this.cancel();
    this.phase = "stopped";
  }

  async repair(): Promise<LocalModelRuntimeHealth> {
    this.release();
    return this.prepare();
  }
}
