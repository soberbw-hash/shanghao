import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import type { AiLocalLlmRuntimeMetrics, RendererLogPayload } from "@private-voice/shared";

import { gpuMemoryUsedMb } from "./asr-benchmark-runtime";
import type {
  LocalLLMProvider,
  LocalLlmGenerateRequest,
  LocalLlmGenerateResult,
  LocalLlmProviderStatus,
} from "./local-llm-provider";
import { runLocalProcess } from "./local-process";
import { platformService } from "./platform/PlatformService";

const SERVED_MODEL = "qwen36-35b-a3b-nvfp4";
const DEFAULT_PORT = 19_193;
const START_TIMEOUT_MS = 20 * 60_000;
const IDLE_RELEASE_MS = 2 * 60_000;
const STDERR_LIMIT = 32_768;

type ProviderPhase = AiLocalLlmRuntimeMetrics["phase"];

interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

interface StreamChunk {
  choices?: Array<{
    delta?: { content?: string };
    text?: string;
    finish_reason?: string | null;
  }>;
  usage?: OpenAiUsage;
  error?: { message?: string };
}

interface JsonResponseDiagnostics {
  finishReason?: string;
  outputTokens?: number;
}

const jsonTopLevelFieldPresence = (value: string): string => {
  const fields = [
    "description",
    "summary",
    "topics",
    "timeline",
    "highlights",
    "funnyMoments",
    "importantInformation",
    "participants",
    "keywords",
  ];
  const present = fields.filter((field) => value.includes(`"${field}"`));
  return present.length > 0 ? present.join(",") : "none";
};

const jsonParseFailureKind = (error: unknown): string => {
  if (!(error instanceof SyntaxError)) return "unknown";
  const message = error.message.toLowerCase();
  if (message.includes("unexpected end") || message.includes("unterminated")) {
    return "truncated";
  }
  const position = message.match(/position\s+(\d+)/)?.[1];
  if (position) return `syntax_at_${position}`;
  return "syntax";
};

const extractJsonObject = <T>(value: string, diagnostics: JsonResponseDiagnostics = {}): T => {
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  const suffix = [
    `chars=${value.length}`,
    `start=${start}`,
    `end=${end}`,
    `finish=${diagnostics.finishReason ?? "unknown"}`,
    `output_tokens=${diagnostics.outputTokens ?? 0}`,
    `fields=${jsonTopLevelFieldPresence(value)}`,
  ].join(":");
  if (start < 0 || end <= start) {
    throw new Error(`freetoken_invalid_json_response:${suffix}:parse=no_object`);
  }
  try {
    return JSON.parse(value.slice(start, end + 1)) as T;
  } catch (error) {
    throw new Error(
      `freetoken_invalid_json_response:${suffix}:parse=${jsonParseFailureKind(error)}`,
      { cause: error },
    );
  }
};

const terminateTree = (child: ChildProcessWithoutNullStreams): void => {
  if (platformService.isWindows && child.pid) {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.unref();
  } else {
    child.kill("SIGKILL");
  }
};

const firstExisting = (values: Array<string | undefined>): string | undefined =>
  values.find((value): value is string => Boolean(value && existsSync(value)));

const candidateCliPaths = (): string[] => {
  const roots = [
    process.env.FREETOKEN_HOME,
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    process.env.ProgramFiles,
  ].filter((value): value is string => Boolean(value));
  const explicit = process.env.SHANGHAO_FREETOKEN_CLI;
  const desktopManaged = process.env.FREETOKEN_FT_BIN;
  const candidates = [explicit, desktopManaged].filter((value): value is string => Boolean(value));
  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "FreeToken", "venv", "Scripts", "ft.exe"));
  }
  for (const root of roots) {
    for (const product of ["FreeToken Desktop", "FreeToken", "ai.flashml.freetoken"]) {
      const base = path.join(root, product);
      candidates.push(
        path.join(base, "engine", ".venv", "Scripts", "ft.exe"),
        path.join(base, "engine", "venv", "Scripts", "ft.exe"),
        path.join(base, ".venv", "Scripts", "ft.exe"),
        path.join(base, "ft.exe"),
      );
    }
  }
  return candidates;
};

const findFreeTokenCli = async (preferred?: string): Promise<string | undefined> => {
  const direct = firstExisting([preferred, ...candidateCliPaths()]);
  if (direct) return direct;
  try {
    const result = await runLocalProcess("where.exe", ["ft.exe"], { timeoutMs: 5_000 });
    return firstExisting(result.stdout.split(/\r?\n/).map((value) => value.trim()));
  } catch {
    return undefined;
  }
};

const processTreeWorkingSetMb = async (rootPid?: number): Promise<number | undefined> => {
  if (!rootPid || !platformService.isWindows) return undefined;
  const script = [
    `$root=${rootPid}`,
    "$rows=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize",
    "$ids=New-Object 'System.Collections.Generic.HashSet[int]'",
    "$null=$ids.Add([int]$root)",
    "do{$before=$ids.Count;foreach($row in $rows){if($ids.Contains([int]$row.ParentProcessId)){$null=$ids.Add([int]$row.ProcessId)}}}while($ids.Count -gt $before)",
    "$sum=($rows | Where-Object {$ids.Contains([int]$_.ProcessId)} | Measure-Object WorkingSetSize -Sum).Sum",
    "[math]::Round(([double]$sum/1MB),1)",
  ].join(";");
  try {
    const result = await runLocalProcess(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        timeoutMs: 8_000,
      },
    );
    const value = Number.parseFloat(result.stdout.trim());
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

const modelGpuMemoryUsedMb = async (baselineMb?: number): Promise<number | undefined> => {
  const totalUsedMb = await gpuMemoryUsedMb();
  if (totalUsedMb === undefined) return undefined;
  // Windows WDDM reports per-process GPU memory as N/A in nvidia-smi. Measuring the
  // sidecar's increase over the immediately preceding desktop baseline is the closest
  // stable figure available without injecting code into FreeToken itself.
  return baselineMb === undefined ? totalUsedMb : Math.max(0, totalUsedMb - baselineMb);
};

const findNumber = (value: unknown, keys: readonly string[]): number | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, candidate] of entries) {
    if (keys.includes(key.toLocaleLowerCase("en-US")) && Number.isFinite(Number(candidate)))
      return Number(candidate);
  }
  for (const [, candidate] of entries) {
    if (Array.isArray(candidate)) {
      for (let index = candidate.length - 1; index >= 0; index -= 1) {
        const found = findNumber(candidate[index], keys);
        if (found !== undefined) return found;
      }
    } else {
      const found = findNumber(candidate, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

/** Official FreeToken CLI sidecar. It never exposes a non-loopback listener. */
export class FreeTokenLocalLlmProvider implements LocalLLMProvider {
  readonly modelId = "qwen36-35b-a3b-nvfp4" as const;
  private executable?: string;
  private version?: string;
  private child?: ChildProcessWithoutNullStreams;
  private ownedServer = false;
  private startPromise?: Promise<void>;
  private stderrTail = "";
  private phase: ProviderPhase = "missing";
  private idleTimer?: NodeJS.Timeout;
  private activeRequest = false;
  private baselineGpuMemoryMb?: number;
  private lastLoadTimeMs?: number;
  private generationQueue: Promise<void> = Promise.resolve();
  private metrics: AiLocalLlmRuntimeMetrics = {
    provider: "freetoken",
    phase: "missing",
    updatedAt: new Date(0).toISOString(),
  };
  private readonly listeners = new Set<(status: LocalLlmProviderStatus) => void>();

  constructor(
    private readonly modelPath: () => string | undefined,
    private readonly modelRevision: string,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
    private readonly port = DEFAULT_PORT,
    private readonly managedExecutable?: () => string | undefined,
    private readonly prepareManagedExecutable?: () => Promise<string | undefined>,
  ) {}

  onStatus(listener: (status: LocalLlmProviderStatus) => void): () => void {
    this.listeners.add(listener);
    void this.status().then(listener);
    return () => this.listeners.delete(listener);
  }

  async prepare(): Promise<LocalLlmProviderStatus> {
    const model = this.modelPath();
    if (!model || !existsSync(path.join(model, "model.safetensors.index.json"))) {
      this.phase = "missing";
      return this.updateStatus(false, "Qwen3.6-35B-A3B NVFP4 模型尚未完整下载。");
    }
    this.executable = await findFreeTokenCli(this.managedExecutable?.());
    if (!this.executable && this.prepareManagedExecutable) {
      this.phase = "starting";
      await this.updateStatus(false);
      try {
        this.executable = await this.prepareManagedExecutable();
      } catch (error) {
        this.phase = "error";
        await this.log("error", "freetoken_managed_runtime_auto_prepare_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        return this.updateStatus(false, "本地整理暂时无法启动，使用时会自动重试。");
      }
    }
    if (this.executable) {
      try {
        const result = await runLocalProcess(this.executable, ["--version"], { timeoutMs: 10_000 });
        this.version = (result.stdout || result.stderr).trim().split(/\s+/).at(-1);
      } catch (error) {
        this.phase = "error";
        await this.log("error", "freetoken_cli_start_failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        return this.updateStatus(false, "本地整理暂时无法启动，使用时会自动重试。");
      }
    }
    if (!this.executable) {
      this.phase = "missing";
      return this.updateStatus(false, "本地整理暂时无法启动，使用时会自动重试。");
    }
    if (await this.healthCheck().catch(() => false)) this.phase = "ready";
    else if (!this.child) this.phase = "stopped";
    return this.updateStatus(true);
  }

  async status(): Promise<LocalLlmProviderStatus> {
    if (!this.executable || !this.modelPath()) return this.prepare();
    const serving = await this.healthCheck().catch(() => false);
    if (serving && this.phase !== "running") this.phase = "ready";
    if (!serving && !this.child && this.phase !== "error") this.phase = "stopped";
    return this.updateStatus(
      true,
      this.phase === "error" ? this.stderrTail.slice(-800) : undefined,
    );
  }

  async generateJson<T>(request: LocalLlmGenerateRequest): Promise<LocalLlmGenerateResult<T>> {
    const operation = this.generationQueue
      .catch(() => undefined)
      .then(() => this.generateJsonOnce<T>(request));
    this.generationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  release(reason: string): void {
    if (this.activeRequest && reason !== "app_stopping") return;
    this.clearIdleTimer();
    const child = this.child;
    this.child = undefined;
    this.startPromise = undefined;
    if (child && this.ownedServer && child.exitCode === null) terminateTree(child);
    this.ownedServer = false;
    this.phase = this.executable ? "stopped" : "missing";
    void this.log("info", "FreeToken sidecar released", { reason });
    void this.updateStatus(Boolean(this.executable && this.modelPath()));
  }

  stop(): void {
    this.release("app_stopping");
  }

  private async generateJsonOnce<T>(
    request: LocalLlmGenerateRequest,
  ): Promise<LocalLlmGenerateResult<T>> {
    if (request.signal?.aborted) throw new Error("ai_task_paused");
    this.clearIdleTimer();
    await this.ensureServer(request.signal);
    const startedAt = performance.now();
    let ttftMs: number | undefined;
    let usage: OpenAiUsage | undefined;
    let finishReason: string | undefined;
    let peakVramMb = await modelGpuMemoryUsedMb(this.baselineGpuMemoryMb);
    let peakRamMb = await processTreeWorkingSetMb(this.child?.pid);
    let output = "";
    this.activeRequest = true;
    this.phase = "running";
    await this.updateStatus(true);
    const sampler = setInterval(() => {
      void modelGpuMemoryUsedMb(this.baselineGpuMemoryMb).then((value) => {
        if (value !== undefined) peakVramMb = Math.max(peakVramMb ?? 0, value);
      });
      void processTreeWorkingSetMb(this.child?.pid).then((value) => {
        if (value !== undefined) peakRamMb = Math.max(peakRamMb ?? 0, value);
      });
      void this.runtimeStats().then((value) => {
        const bytes = findNumber(value, ["vram_bytes"]);
        if (bytes !== undefined) peakVramMb = Math.max(peakVramMb ?? 0, bytes / 1024 / 1024);
      });
    }, 5_000);
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl()}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: SERVED_MODEL,
            messages: [
              {
                role: "system",
                content:
                  "Return exactly one valid JSON object. Do not use Markdown fences or add explanations.",
              },
              { role: "user", content: request.prompt },
            ],
            temperature: 0.2,
            // Recording organization needs the final structured answer, not a
            // long hidden chain-of-thought that can consume the entire output
            // budget before `content` begins.
            reasoning_effort: "none",
            max_tokens: request.maxNewTokens,
            stream: true,
            stream_options: { include_usage: true },
          }),
        },
        request.timeoutMs,
        request.signal,
      );
      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw new Error(`freetoken_http_${response.status}:${detail.slice(-800)}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let boundary = buffer.indexOf("\n");
        while (boundary >= 0) {
          const line = buffer.slice(0, boundary).trim();
          buffer = buffer.slice(boundary + 1);
          if (line.startsWith("data:")) {
            const data = line.slice(5).trim();
            if (data && data !== "[DONE]") {
              const chunk = JSON.parse(data) as StreamChunk;
              if (chunk.error?.message)
                throw new Error(`freetoken_request_failed:${chunk.error.message}`);
              const choice = chunk.choices?.[0];
              const content = choice?.delta?.content ?? choice?.text ?? "";
              if (choice?.finish_reason) finishReason = choice.finish_reason;
              if (content) {
                if (ttftMs === undefined) ttftMs = performance.now() - startedAt;
                output += content;
              }
              if (chunk.usage) usage = chunk.usage;
            }
          }
          boundary = buffer.indexOf("\n");
        }
        if (done) break;
      }
      const elapsedMs = Math.max(1, performance.now() - startedAt);
      const requestStats = await this.requestStats().catch(() => undefined);
      const inputTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;
      const outputTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
      const decodeMs = Math.max(1, elapsedMs - (ttftMs ?? elapsedMs));
      const tokensPerSecond = outputTokens > 0 ? (outputTokens * 1_000) / decodeMs : undefined;
      const prefillTimeMs = findNumber(requestStats, [
        "prefill_ms",
        "prefill_time_ms",
        "prefill_latency_ms",
        "prefill_latency",
      ]);
      const engineVramBytes = findNumber(requestStats, ["vram_bytes"]);
      peakVramMb =
        Math.max(
          peakVramMb ?? 0,
          (await modelGpuMemoryUsedMb(this.baselineGpuMemoryMb)) ?? 0,
          engineVramBytes === undefined ? 0 : engineVramBytes / 1024 / 1024,
        ) || undefined;
      peakRamMb =
        Math.max(peakRamMb ?? 0, (await processTreeWorkingSetMb(this.child?.pid)) ?? 0) ||
        undefined;
      this.metrics = {
        provider: "freetoken",
        phase: "ready",
        version: this.version,
        modelRevision: this.modelRevision,
        processId: this.child?.pid,
        loadTimeMs: this.lastLoadTimeMs,
        gpuMemoryMb: peakVramMb,
        ramMemoryMb: peakRamMb,
        tokensPerSecond,
        updatedAt: new Date().toISOString(),
      };
      return {
        value: extractJsonObject<T>(output, { finishReason, outputTokens }),
        metrics: {
          modelName: "Qwen3.6-35B-A3B",
          modelRevision: this.modelRevision,
          quantization: "NVFP4",
          provider: "freetoken",
          providerVersion: this.version,
          modelLoadTimeMs: this.lastLoadTimeMs,
          inputTokens,
          outputTokens,
          prefillTimeMs,
          ttftMs,
          outputTokensPerSecond: tokensPerSecond,
          totalElapsedMs: Math.round(elapsedMs),
          peakVramMb,
          peakRamMb,
          oomCount: 0,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/out of memory|oom|cuda.*memory|insufficient.*memory/i.test(message)) {
        await this.log("error", "FreeToken request ran out of memory", { message });
      }
      if (request.signal?.aborted) {
        this.release("request_paused");
        throw new Error("ai_task_paused", { cause: error });
      }
      if (/terminated|fetch failed|socket|connection|econnreset/i.test(message)) {
        const diagnostic = this.stderrTail.slice(-2_400);
        await this.log("error", "FreeToken request transport failed", {
          message,
          diagnostic,
        });
        throw new Error(
          `freetoken_request_transport_failed:${message}:${diagnostic || "no_runtime_diagnostic"}`,
          { cause: error },
        );
      }
      throw error;
    } finally {
      clearInterval(sampler);
      this.activeRequest = false;
      if (this.child) this.phase = "ready";
      await this.updateStatus(Boolean(this.executable && this.modelPath()));
      this.scheduleIdleRelease();
    }
  }

  private async ensureServer(signal?: AbortSignal): Promise<void> {
    const prepared = await this.prepare();
    if (!prepared.ready || !this.executable)
      throw new Error(prepared.message ?? "freetoken_missing");
    if (await this.healthCheck()) return;
    if (this.startPromise) return this.startPromise;
    const model = this.modelPath();
    if (!model) throw new Error("model_qwen36-35b-a3b-nvfp4_not_installed");
    this.baselineGpuMemoryMb = await gpuMemoryUsedMb();
    this.phase = "starting";
    this.stderrTail = "";
    this.startPromise = new Promise<void>((resolve, reject) => {
      const child = spawn(
        this.executable as string,
        [
          "serve",
          "--model",
          model,
          "--served-model-name",
          SERVED_MODEL,
          "--host",
          "127.0.0.1",
          "--port",
          String(this.port),
          "--max-running-requests",
          "1",
          "--max-output-tokens",
          "4096",
          "--max-prefill-length",
          "32768",
          "--moe-backend",
          "auto",
        ],
        { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      this.child = child;
      this.ownedServer = true;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      const consume = (value: string) => {
        this.stderrTail = `${this.stderrTail}${value}`.slice(-STDERR_LIMIT);
        if (/load|initializ|allocat|warming/i.test(value)) this.phase = "loading";
      };
      child.stdout.on("data", consume);
      child.stderr.on("data", consume);
      child.on("error", (error) => reject(new Error(`freetoken_spawn_failed:${error.message}`)));
      child.on("close", (code) => {
        if (this.child !== child) return;
        this.child = undefined;
        this.ownedServer = false;
        if (this.phase !== "stopped") {
          this.phase = "error";
          this.startPromise = undefined;
          void this.updateStatus(
            false,
            `FreeToken 服务异常退出 (${code})：${this.stderrTail.slice(-800)}`,
          );
        }
      });
      const startedAt = Date.now();
      const poll = async () => {
        if (signal?.aborted) {
          terminateTree(child);
          return reject(new Error("ai_task_paused"));
        }
        if (await this.healthCheck()) {
          this.phase = "ready";
          this.startPromise = undefined;
          this.lastLoadTimeMs = Date.now() - startedAt;
          await this.log("info", "FreeToken sidecar ready", {
            executable: this.executable,
            version: this.version,
            model,
            host: "127.0.0.1",
            port: this.port,
            loadTimeMs: this.lastLoadTimeMs,
          });
          await this.updateStatus(true);
          return resolve();
        }
        if (Date.now() - startedAt >= START_TIMEOUT_MS) {
          terminateTree(child);
          this.phase = "error";
          this.startPromise = undefined;
          return reject(new Error(`freetoken_load_timeout:${this.stderrTail.slice(-1_200)}`));
        }
        setTimeout(() => void poll(), 1_000);
      };
      void poll();
    });
    return this.startPromise;
  }

  private async healthCheck(): Promise<boolean> {
    const response = await this.fetchWithTimeout(`${this.baseUrl()}/health`, {}, 2_000).catch(
      () => undefined,
    );
    if (!response?.ok) return false;
    const health = (await response.json().catch(() => undefined)) as
      { status?: unknown } | undefined;
    // FreeToken exposes the HTTP server and /v1/models while expert banks are
    // still loading. Requests made in that window return 503, so the process
    // being reachable is not enough to declare the model ready.
    if (typeof health?.status === "string") {
      const status = health.status.toLowerCase();
      if (status !== "ready" && status !== "ok") return false;
    }
    const models = await this.fetchWithTimeout(`${this.baseUrl()}/v1/models`, {}, 2_000).catch(
      () => undefined,
    );
    if (!models?.ok) return false;
    const payload = (await models.json()) as { data?: Array<{ id?: string }> };
    return payload.data?.some((model) => model.id === SERVED_MODEL) === true;
  }

  private async requestStats(): Promise<unknown> {
    const [requestLog, runtime] = await Promise.all([
      this.fetchWithTimeout(`${this.baseUrl()}/v1/requests?limit=512`, {}, 5_000).then(
        async (response) => (response.ok ? response.json() : undefined),
      ),
      this.runtimeStats(),
    ]);
    const entries =
      requestLog && typeof requestLog === "object"
        ? (requestLog as { entries?: unknown[] }).entries
        : undefined;
    return { request: entries?.at(-1), runtime };
  }

  private async runtimeStats(): Promise<unknown> {
    const response = await this.fetchWithTimeout(`${this.baseUrl()}/v1/stats`, {}, 5_000);
    return response.ok ? response.json() : undefined;
  }

  private fetchWithTimeout(
    input: string,
    init: RequestInit,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    return fetch(input, { ...init, signal: controller.signal }).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    });
  }

  private updateStatus(ready: boolean, message?: string): LocalLlmProviderStatus {
    this.metrics = {
      ...this.metrics,
      phase: this.phase,
      version: this.version,
      modelRevision: this.modelRevision,
      processId: this.child?.pid,
      loadTimeMs: this.lastLoadTimeMs,
      updatedAt: new Date().toISOString(),
    };
    const status = { ready, message, executable: this.executable, metrics: { ...this.metrics } };
    for (const listener of this.listeners) listener(status);
    return status;
  }

  private scheduleIdleRelease(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => this.release("idle_timeout"), IDLE_RELEASE_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  private baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private log(
    level: RendererLogPayload["level"],
    message: string,
    context: Record<string, unknown>,
  ) {
    return this.writeLog?.({ category: "app", level, message, context }) ?? Promise.resolve();
  }
}
