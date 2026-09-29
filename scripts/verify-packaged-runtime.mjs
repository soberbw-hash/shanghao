import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { extractFile, listPackage } from "@electron/asar";

const releaseDirectory = path.resolve(import.meta.dirname, "..", "apps", "desktop", "release");
const unpackedDirectory = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(releaseDirectory, "win-unpacked");
const resourcesDirectory = path.join(unpackedDirectory, "resources");
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
for (const runner of [runtimeManifest.qwen.runner, runtimeManifest.asr?.runner]) {
  if (!runner) throw new Error("Packaged AI runtime manifest is missing a runner");
  const runnerPath = path.join(resourcesDirectory, "ai", runner.path);
  const runnerHash = createHash("sha256")
    .update(await readFile(runnerPath))
    .digest("hex");
  if (runnerHash !== runner.sha256) {
    throw new Error(`Packaged AI runtime hash mismatch: ${runner.path}`);
  }
}

for (const nativeHelper of ["shanghao-core.exe", "ShangHao.PhoneAudio.exe"]) {
  const nativeHelperPath = path.join(resourcesDirectory, "native", nativeHelper);
  await access(nativeHelperPath);
  if ((await stat(nativeHelperPath)).size < 1024) {
    throw new Error(`Packaged native helper is incomplete: ${nativeHelper}`);
  }
}

const entries = listPackage(archivePath, { isPack: false });
const normalizedEntries = entries.map((entry) => entry.replaceAll("\\", "/"));
const fontEntries = normalizedEntries.filter((entry) => entry.endsWith(".woff2"));
const targetUiohook = "/node_modules/uiohook-napi/prebuilds/win32-x64/uiohook-napi.node";
if (!normalizedEntries.some((entry) => entry.endsWith(targetUiohook))) {
  throw new Error("Packaged Windows x64 mouse shortcut addon is missing");
}
if (
  normalizedEntries.some((entry) =>
    /\/node_modules\/uiohook-napi\/prebuilds\/(?!win32-x64\/)[^/]+\//.test(entry),
  )
) {
  throw new Error("Packaged uiohook addon contains a non-target platform binary");
}
if (normalizedEntries.some((entry) => /\/node_modules\/@private-voice\/[^/]+\/src\//.test(entry))) {
  throw new Error("Packaged workspace dependency contains unused TypeScript source");
}
if (
  normalizedEntries.some((entry) =>
    entry.includes("/node_modules/@cloudbase/js-sdk/miniprogram_dist/"),
  )
) {
  throw new Error("Packaged Windows client contains CloudBase mini-program distribution");
}

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
  `Packaged runtime verified: CloudBase login config, AI runner integrity, native helpers, ${fontEntries.length} font files, DeepFilterNet assets, ${quickMessageFiles.length} AAC voice clips, and all licenses`,
);
