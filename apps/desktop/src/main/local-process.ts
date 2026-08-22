import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import { platformService } from "./platform/PlatformService";

export interface LocalProcessResult {
  stdout: string;
  stderr: string;
}

/** Runs a hidden child process with bounded lifecycle and UTF-8 output. */
export const runLocalProcess = async (
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    timeoutMs: number;
    input?: string;
  },
): Promise<LocalProcessResult> =>
  new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(new Error("ai_task_paused"));
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return reject(new Error(`ai_runtime_spawn_failed: ${detail}`, { cause: error }));
    }
    let stdout = "";
    let stderr = "";
    let terminationReason: "paused" | "timeout" | undefined;
    let terminationFallback: NodeJS.Timeout | undefined;
    const terminate = (reason: "paused" | "timeout") => {
      if (terminationReason) return;
      terminationReason = reason;
      if (platformService.isWindows && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.unref();
      } else {
        child.kill("SIGKILL");
      }
      terminationFallback = setTimeout(() => {
        options.signal?.removeEventListener("abort", abort);
        reject(new Error(reason === "paused" ? "ai_task_paused" : "ai_runtime_timeout"));
      }, 3_000);
    };
    const timeout = setTimeout(() => terminate("timeout"), options.timeoutMs);
    const abort = () => terminate("paused");
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (value: string) => (stdout += value));
    child.stderr.on("data", (value: string) => (stderr += value));
    child.stdin.end(options.input ?? "");
    child.on("error", (error) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      const detail = error instanceof Error ? error.message : String(error);
      reject(new Error(`ai_runtime_spawn_failed: ${detail}`, { cause: error }));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (terminationFallback) clearTimeout(terminationFallback);
      options.signal?.removeEventListener("abort", abort);
      if (terminationReason === "paused" || options.signal?.aborted)
        return reject(new Error("ai_task_paused"));
      if (terminationReason === "timeout") return reject(new Error("ai_runtime_timeout"));
      if (code !== 0) return reject(new Error(`ai_runtime_exit_${code}: ${stderr.slice(-500)}`));
      resolve({ stdout, stderr });
    });
  });
