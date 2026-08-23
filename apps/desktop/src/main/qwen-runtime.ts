import { access } from "node:fs/promises";
import path from "node:path";

import {
  type LocalModelResourceUsage,
  type LocalModelRuntime,
  type LocalModelRuntimeHealth,
  type LocalModelRuntimeProgress,
} from "./local-model-runtime";
import { QwenPersistentWorker, type QwenWorkerHealth } from "./qwen-persistent-worker";

export interface QwenRuntimeRequest {
  prompt: string;
  maxNewTokens: number;
  resourceMode: "low" | "normal";
  timeoutMs: number;
  signal?: AbortSignal;
}

const exists = (filePath: string): Promise<boolean> =>
  access(filePath).then(
    () => true,
    () => false,
  );

export class QwenRuntime implements LocalModelRuntime<QwenRuntimeRequest, string> {
  private readonly worker: QwenPersistentWorker;

  constructor(
    private readonly pythonExecutable: string,
    private readonly runnerPath: string,
    private readonly modelPath: () => string | undefined,
    pythonPath?: string,
  ) {
    this.worker = new QwenPersistentWorker(pythonExecutable, runnerPath, modelPath, pythonPath);
  }

  onState(listener: (health: QwenWorkerHealth) => void): () => void {
    return this.worker.onState(listener);
  }

  workerHealth(): QwenWorkerHealth {
    return this.worker.health();
  }

  prepare(): Promise<LocalModelRuntimeHealth> {
    return this.health();
  }

  async health(): Promise<LocalModelRuntimeHealth> {
    const worker = this.worker.health();
    const model = this.modelPath();
    const ready = Boolean(
      model &&
      (await exists(this.pythonExecutable)) &&
      (await exists(this.runnerPath)) &&
      (await exists(path.join(model, "config.json"))),
    );
    return {
      id: "qwen35-4b",
      phase: ready
        ? worker.phase === "crashed"
          ? "error"
          : worker.phase === "starting"
            ? "preparing"
            : worker.phase
        : "missing",
      ready,
      loaded: worker.loaded,
      executable: ready ? this.pythonExecutable : undefined,
      processId: worker.processId,
      queuedJobs: worker.queuedJobs,
      activeJobId: worker.activeJobId,
      detail: worker.lastError,
    };
  }

  load(): Promise<void> {
    return this.worker.load();
  }

  run(request: QwenRuntimeRequest): Promise<string> {
    return this.worker.run(request);
  }

  cancel(jobId?: string): void {
    if (jobId) this.worker.cancel(jobId);
    else this.worker.release("ai_task_paused");
  }

  progress(): LocalModelRuntimeProgress {
    const worker = this.worker.health();
    return {
      phase:
        worker.phase === "crashed"
          ? "error"
          : worker.phase === "starting"
            ? "preparing"
            : worker.phase,
      completedUnits: worker.loaded ? 1 : 0,
      totalUnits: 1,
      message: worker.lastError,
    };
  }

  resourceUsage(): LocalModelResourceUsage {
    const worker = this.worker.health();
    return {
      processId: worker.processId,
      loaded: worker.loaded,
      activeJobs: worker.activeJobId ? 1 : 0,
      queuedJobs: worker.queuedJobs,
    };
  }

  release(reason?: string): void {
    this.worker.release(reason);
  }

  async repair(): Promise<LocalModelRuntimeHealth> {
    this.release("repair");
    return this.prepare();
  }
}
