import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { platformService } from "./platform/PlatformService";

const execFileAsync = promisify(execFile);

export interface WindowsCommandResult {
  stdout: string;
  stderr: string;
}

export const runWindowsPowerShell = async (
  script: string,
  environment: Record<string, string | undefined> = {},
): Promise<WindowsCommandResult> => {
  if (!platformService.isWindows) {
    throw new Error("windows_command_not_supported");
  }

  const powershellPath = join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const { stdout, stderr } = await execFileAsync(
    powershellPath,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, ...environment },
    },
  );

  return { stdout: stdout.trim(), stderr: stderr.trim() };
};

export const parsePowerShellJson = <T>(stdout: string): T => {
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .at(-1);
  if (!line) throw new Error("windows_command_returned_no_data");
  return JSON.parse(line) as T;
};
