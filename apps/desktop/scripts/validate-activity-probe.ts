/* eslint-disable no-console -- this developer CLI reports its probe result to stdout/stderr */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  buildGameDetectionProbeCommand,
  buildMediaSessionProbeCommand,
  type ProcessSnapshot,
} from "../src/main/game-detection";

const execFileAsync = promisify(execFile);

const run = async (command: string): Promise<string> => {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 8_000 },
  );
  return stdout;
};

const main = async (): Promise<void> => {
  const processRaw = await run(buildGameDetectionProbeCommand());
  const parsedProcesses = JSON.parse(processRaw) as ProcessSnapshot | ProcessSnapshot[];
  const processes = Array.isArray(parsedProcesses) ? parsedProcesses : [parsedProcesses];
  const foreground = processes.find((processInfo) => processInfo.IsForeground);
  const mediaRaw = await run(buildMediaSessionProbeCommand()).catch(() => "[]");
  const parsedMedia = JSON.parse(mediaRaw) as unknown;
  const mediaSessionCount = Array.isArray(parsedMedia) ? parsedMedia.length : parsedMedia ? 1 : 0;

  console.log(
    JSON.stringify(
      {
        ok: true,
        processCount: processes.length,
        foreground: foreground
          ? {
              processName: foreground.ProcessName,
              hasPath: Boolean(foreground.PathBase64),
              hasProductName: Boolean(foreground.ProductNameBase64),
              hasFileDescription: Boolean(foreground.FileDescriptionBase64),
              hasParent: Boolean(foreground.ParentProcessId),
            }
          : undefined,
        mediaSessionCount,
      },
      null,
      2,
    ),
  );
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
