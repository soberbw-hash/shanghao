import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import ffmpegPath from "ffmpeg-static";

import { platformService } from "./platform/PlatformService";

let cachedFfmpegExecutable: string | undefined;

const executableName = platformService.isWindows ? "ffmpeg.exe" : "ffmpeg";

const isExistingExecutable = (candidate: string | null | undefined): candidate is string => {
  if (!candidate || candidate.includes("app.asar") || !existsSync(candidate)) return false;

  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
};

const isUsableExecutable = (candidate: string | null | undefined): candidate is string => {
  if (!isExistingExecutable(candidate)) return false;

  try {
    const probe = spawnSync(candidate, ["-version"], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });
    return probe.status === 0 && /ffmpeg version/i.test(`${probe.stdout}\n${probe.stderr}`);
  } catch {
    return false;
  }
};

const findPnpmStoreRoot = (candidate: string | null): string | undefined => {
  if (!candidate) return undefined;
  let current = path.dirname(candidate);
  for (let depth = 0; depth < 8; depth += 1) {
    if (path.basename(current) === ".pnpm") return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
};

const findPnpmFfmpegCandidates = (storeRoot: string | undefined): string[] => {
  if (!storeRoot || !existsSync(storeRoot)) return [];
  try {
    return readdirSync(storeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("ffmpeg-static@"))
      .sort((left, right) => left.name.length - right.name.length)
      .map((entry) =>
        path.join(storeRoot, entry.name, "node_modules", "ffmpeg-static", executableName),
      );
  } catch {
    return [];
  }
};

/**
 * Resolve and verify an executable path that remains runnable after Electron packaging.
 *
 * pnpm can create more than one virtual-store instance for ffmpeg-static. Its JS export may
 * point at a peer-qualified instance whose postinstall binary is absent, while the downloaded
 * binary is present in the unqualified instance. Keep packaged resources first, then repair
 * that development-only virtual-store mismatch without downloading or copying the 80 MB file.
 */
export const resolveFfmpegExecutable = (): string | undefined => {
  if (isExistingExecutable(cachedFfmpegExecutable)) return cachedFfmpegExecutable;

  const packagedPath = path.join(process.resourcesPath ?? "", "ffmpeg", executableName);

  const pnpmStoreRoots = new Set<string>();
  const importedStoreRoot = findPnpmStoreRoot(ffmpegPath);
  if (importedStoreRoot) pnpmStoreRoots.add(importedStoreRoot);
  pnpmStoreRoots.add(path.resolve(process.cwd(), "node_modules", ".pnpm"));
  pnpmStoreRoots.add(path.resolve(process.cwd(), "..", "..", "node_modules", ".pnpm"));

  const candidates = [
    packagedPath,
    ffmpegPath,
    ...Array.from(pnpmStoreRoots).flatMap(findPnpmFfmpegCandidates),
  ];
  for (const candidate of new Set(candidates)) {
    if (isUsableExecutable(candidate)) {
      cachedFfmpegExecutable = candidate;
      return candidate;
    }
  }

  return undefined;
};
