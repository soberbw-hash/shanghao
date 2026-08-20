import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

interface RuntimeManifestFile {
  path: string;
  sha256: string;
}

export interface AiRuntimePackageManifest {
  schemaVersion: 1;
  packageVersion: string;
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

export const sha256File = async (filePath: string): Promise<string> =>
  createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");

export const readAiRuntimeManifest = async (
  manifestPath: string,
): Promise<AiRuntimePackageManifest> => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as AiRuntimePackageManifest;
  if (
    manifest.schemaVersion !== 1 ||
    manifest.platform !== "win32-x64" ||
    !manifest.packageVersion ||
    !Array.isArray(manifest.vibevoice?.files) ||
    !manifest.qwen?.runner?.path
  ) {
    throw new Error("ai_runtime_manifest_invalid");
  }
  return manifest;
};

/** Installs bundled, pinned runtime files without touching user models or existing valid files. */
export const prepareBundledAiRuntime = async (options: {
  runtimeRoot: string;
  bundledRoot: string;
}): Promise<AiRuntimePackageManifest | undefined> => {
  const bundledManifest = path.join(options.bundledRoot, "runtime-manifest.json");
  if (!existsSync(bundledManifest)) return undefined;
  const manifest = await readAiRuntimeManifest(bundledManifest);
  await mkdir(options.runtimeRoot, { recursive: true });
  const files = [...manifest.vibevoice.files, manifest.qwen.runner];
  for (const file of files) {
    const source = safeRuntimePath(options.bundledRoot, file.path);
    if (!existsSync(source)) continue;
    if ((await sha256File(source)) !== file.sha256) throw new Error("ai_runtime_integrity_failed");
    const destination = safeRuntimePath(options.runtimeRoot, file.path);
    if (existsSync(destination) && (await sha256File(destination)) === file.sha256) continue;
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    await copyFile(source, temporary);
    if ((await sha256File(temporary)) !== file.sha256) throw new Error("ai_runtime_copy_failed");
    // Only replace this exact runtime file after both source and temporary copy are verified.
    await rm(destination, { force: true });
    await rename(temporary, destination);
  }
  const installedManifest = path.join(options.runtimeRoot, "runtime-manifest.json");
  const temporaryManifest = `${installedManifest}.${process.pid}.tmp`;
  await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rm(installedManifest, { force: true });
  await rename(temporaryManifest, installedManifest);
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
