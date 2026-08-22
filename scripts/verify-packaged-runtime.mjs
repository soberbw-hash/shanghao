import { createHash } from "node:crypto";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { listPackage } from "@electron/asar";

const releaseDirectory = path.resolve(import.meta.dirname, "..", "apps", "desktop", "release");
const resourcesDirectory = path.join(releaseDirectory, "win-unpacked", "resources");
const archivePath = path.join(resourcesDirectory, "app.asar");
await access(archivePath);

const runtimeManifestPath = path.join(resourcesDirectory, "ai", "runtime-manifest.json");
const runtimeManifest = JSON.parse(await readFile(runtimeManifestPath, "utf8"));
const qwenRunnerPath = path.join(resourcesDirectory, "ai", runtimeManifest.qwen.runner.path);
const qwenRunner = await readFile(qwenRunnerPath);
const qwenRunnerHash = createHash("sha256").update(qwenRunner).digest("hex");
if (qwenRunnerHash !== runtimeManifest.qwen.runner.sha256) {
  throw new Error(`Packaged AI runtime hash mismatch: ${runtimeManifest.qwen.runner.path}`);
}

const entries = listPackage(archivePath, { isPack: false }).map((entry) =>
  entry.replaceAll("\\", "/"),
);
const fontEntries = entries.filter((entry) => entry.endsWith(".woff2"));

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

console.log(
  `Packaged runtime verified: AI runner integrity, ${fontEntries.length} font files, DeepFilterNet assets, and all licenses`,
);
