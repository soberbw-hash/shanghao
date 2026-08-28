import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { extractFile, listPackage } from "@electron/asar";

const releaseDirectory = path.resolve(import.meta.dirname, "..", "apps", "desktop", "release");
const resourcesDirectory = path.join(releaseDirectory, "win-unpacked", "resources");
const archivePath = path.join(resourcesDirectory, "app.asar");
await access(archivePath);

const listFilesRecursively = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
      }),
    )
  ).flat();
};

const runtimeManifestPath = path.join(resourcesDirectory, "ai", "runtime-manifest.json");
const runtimeManifest = JSON.parse(await readFile(runtimeManifestPath, "utf8"));
const qwenRunnerPath = path.join(resourcesDirectory, "ai", runtimeManifest.qwen.runner.path);
const qwenRunner = await readFile(qwenRunnerPath);
const qwenRunnerHash = createHash("sha256").update(qwenRunner).digest("hex");
if (qwenRunnerHash !== runtimeManifest.qwen.runner.sha256) {
  throw new Error(`Packaged AI runtime hash mismatch: ${runtimeManifest.qwen.runner.path}`);
}

const entries = listPackage(archivePath, { isPack: false });
const normalizedEntries = entries.map((entry) => entry.replaceAll("\\", "/"));
const fontEntries = normalizedEntries.filter((entry) => entry.endsWith(".woff2"));

const rendererScriptEntries = entries.filter((entry) => {
  const normalizedEntry = entry.replaceAll("\\", "/");
  return normalizedEntry.includes("/dist/assets/") && normalizedEntry.endsWith(".js");
});
const rendererSource = rendererScriptEntries
  .map((entry) => extractFile(archivePath, entry.replace(/^[\\/]/, "")).toString("utf8"))
  .join("\n");
if (
  !rendererSource.includes("shanghao-d3ga95tc8224e727a") ||
  !rendererSource.includes("ap-shanghai") ||
  !rendererSource.includes("eyJhbGci")
) {
  throw new Error(
    "Packaged CloudBase client configuration is missing; refusing to publish a build that cannot log in",
  );
}

if (fontEntries.length === 0) throw new Error("Offline Noto Sans SC font was not bundled");

for (const [assetName, minimumBytes] of [
  ["df_bg.wasm", 9_000_000],
  ["DeepFilterNet3_onnx.tar.gz", 7_000_000],
]) {
  const assetPath = path.join(resourcesDirectory, "deepfilter", assetName);
  await access(assetPath);
  if ((await stat(assetPath)).size < minimumBytes) {
    throw new Error(`DeepFilterNet asset is incomplete: ${assetName}`);
  }
}

for (const licenseName of [
  "THIRD_PARTY_NOTICES.md",
  "deepfilternet3-noise-filter-APACHE-2.0.txt",
  "NotoSansSC-OFL-1.1.txt",
]) {
  const licensePath = path.join(resourcesDirectory, "licenses", licenseName);
  await access(licensePath);
  if ((await readFile(licensePath, "utf8")).trim().length === 0) {
    throw new Error(`Packaged license is empty: ${licenseName}`);
  }
}

const quickMessageDirectory = path.join(resourcesDirectory, "quick-messages");
const quickMessageFiles = await listFilesRecursively(quickMessageDirectory);
if (quickMessageFiles.length !== 47) {
  throw new Error(`Expected 47 quick-message AAC files, found ${quickMessageFiles.length}`);
}
for (const filePath of quickMessageFiles) {
  if (path.extname(filePath).toLowerCase() !== ".aac") {
    throw new Error(`Quick-message pack contains a non-AAC file: ${path.basename(filePath)}`);
  }
  const header = (await readFile(filePath)).subarray(0, 2);
  if (header[0] !== 0xff || ((header[1] ?? 0) & 0xf0) !== 0xf0) {
    throw new Error(`Quick-message pack contains an invalid AAC file: ${path.basename(filePath)}`);
  }
}

console.log(
  `Packaged runtime verified: CloudBase login config, AI runner integrity, ${fontEntries.length} font files, DeepFilterNet assets, ${quickMessageFiles.length} AAC voice clips, and all licenses`,
);
