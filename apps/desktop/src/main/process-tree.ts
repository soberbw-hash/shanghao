import { spawn, type ChildProcess } from "node:child_process";

import { platformService } from "./platform/PlatformService";

const DEFAULT_TERMINATION_TIMEOUT_MS = 3_000;

/**
 * Terminates a child and its descendants, then waits for the child to actually exit.
 * Model runtimes must not overlap while Windows is still releasing RAM and GPU allocations.
 */
export const terminateProcessTree = (
  child: ChildProcess,
  timeoutMs = DEFAULT_TERMINATION_TIMEOUT_MS,
): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener("close", finish);
      child.removeListener("exit", finish);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);
    timeout.unref?.();
    child.once("close", finish);
    child.once("exit", finish);

    try {
      if (platformService.isWindows && child.pid) {
        const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
        killer.once("error", () => {
          try {
            child.kill("SIGKILL");
          } catch {
            finish();
          }
        });
        return;
      }
      child.kill("SIGKILL");
    } catch {
      finish();
    }
  });
};
