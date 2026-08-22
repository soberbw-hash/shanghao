import { existsSync } from "node:fs";
import path from "node:path";

import ffmpegPath from "ffmpeg-static";

import { platformService } from "./platform/PlatformService";

/** Resolve an executable path that remains runnable after Electron packaging. */
export const resolveFfmpegExecutable = (): string | undefined => {
  const packagedPath = path.join(
    process.resourcesPath ?? "",
    "ffmpeg",
    platformService.isWindows ? "ffmpeg.exe" : "ffmpeg",
  );
  if (existsSync(packagedPath)) return packagedPath;
  if (ffmpegPath && existsSync(ffmpegPath) && !ffmpegPath.includes("app.asar")) {
    return ffmpegPath;
  }
  return undefined;
};
