import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";

interface RuntimeManifestFile {
  path: string;
  sha256: string;
}

export interface AiRuntimePackageManifest {
  schemaVersion: 1;
  runtimePackageVersion: string;
  platform: "win32-x64";
  vibevoice: {
    source: "microsoft/VibeASR.cpp";
    revision: string;
    files: RuntimeManifestFile[];
  };
  qwen: {
    pythonVersion: string;
    torchVersion: string;
    transformersVersion: string;
    runner: RuntimeManifestFile;
  };
  asr?: { runner: RuntimeManifestFile };
}

const safeRuntimePath = (root: string, relativePath: string): string => {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized
      .split("/")
      .some((part) => !part || part === "." || part === ".." || part.includes(":"))
  ) {
    throw new Error("unsafe_ai_runtime_path");
  }
  return path.join(root, ...normalized.split("/"));
};

export const sha256File = async (filePath: string): Promise<string> => {
  const hash = createHash("sha256");
  await pipeline(
    createReadStream(filePath),
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        done();
      },
    }),
  );
  return hash.digest("hex");
};

export const readAiRuntimeManifest = async (
  manifestPath: string,
): Promise<AiRuntimePackageManifest> => {
  const raw = JSON.parse(await readFile(manifestPath, "utf8")) as AiRuntimePackageManifest & {
    packageVersion?: string;
  };
  const manifest = {
    ...raw,
    runtimePackageVersion: raw.runtimePackageVersion ?? raw.packageVersion,
  };
  if (
    manifest.schemaVersion !== 1 ||
    manifest.platform !== "win32-x64" ||
    !manifest.runtimePackageVersion ||
    !Array.isArray(manifest.vibevoice?.files) ||
    !manifest.qwen?.runner?.path
  ) {
    throw new Error("ai_runtime_manifest_invalid");
  }
  return manifest as AiRuntimePackageManifest;
};

/** Installs bundled, pinned runtime files without touching user models or existing valid files. */
export const prepareBundledAiRuntime = async (options: {
  runtimeRoot: string;
  bundledRoot: string;
  developmentScriptRoot?: string;
}): Promise<AiRuntimePackageManifest | undefined> => {
  const bundledManifest = path.join(options.bundledRoot, "runtime-manifest.json");
  if (!existsSync(bundledManifest)) return undefined;
  const manifest = await readAiRuntimeManifest(bundledManifest);
  await mkdir(options.runtimeRoot, { recursive: true });
  const files = [...manifest.vibevoice.files, manifest.qwen.runner, manifest.asr?.runner].filter(
    (file): file is RuntimeManifestFile => Boolean(file),
  );
  for (const file of files) {
    const source =
      options.developmentScriptRoot &&
      (file.path === manifest.qwen.runner.path || file.path === manifest.asr?.runner.path)
        ? safeRuntimePath(options.developmentScriptRoot, file.path)
        : safeRuntimePath(options.bundledRoot, file.path);
    if (!existsSync(source)) continue;
    if ((await sha256File(source)) !== file.sha256) throw new Error("ai_runtime_integrity_failed");
    const destination = safeRuntimePath(options.runtimeRoot, file.path);
    if (existsSync(destination) && (await sha256File(destination)) === file.sha256) continue;
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
      await copyFile(source, temporary);
      if ((await sha256File(temporary)) !== file.sha256) throw new Error("ai_runtime_copy_failed");
      // Rename replaces only the verified target; a failed rename leaves the old runtime intact.
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
  const installedManifest = path.join(options.runtimeRoot, "runtime-manifest.json");
  const serializedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  if (
    await readFile(installedManifest, "utf8")
      .then((value) => value === serializedManifest)
      .catch(() => false)
  ) {
    return manifest;
  }
  const temporaryManifest = `${installedManifest}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryManifest, serializedManifest, "utf8");
    await rename(temporaryManifest, installedManifest);
  } finally {
    await rm(temporaryManifest, { force: true }).catch(() => undefined);
  }
  return manifest;
};

export const verifyVibeVoiceRuntimePackage = async (
  runtimeRoot: string,
  manifest: AiRuntimePackageManifest,
): Promise<{ valid: boolean; missing: string[]; corrupt: string[] }> => {
  const missing: string[] = [];
  const corrupt: string[] = [];
  for (const file of manifest.vibevoice.files) {
    const resolved = safeRuntimePath(runtimeRoot, file.path);
    if (!existsSync(resolved)) {
      missing.push(file.path);
    } else if ((await sha256File(resolved)) !== file.sha256) {
      corrupt.push(file.path);
    }
  }
  return { valid: missing.length === 0 && corrupt.length === 0, missing, corrupt };
};
