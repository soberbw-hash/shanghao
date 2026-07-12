import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { listPackage } from "@electron/asar";

const releaseDirectory = path.resolve(import.meta.dirname, "..", "apps", "desktop", "release");
const resourcesDirectory = path.join(releaseDirectory, "win-unpacked", "resources");
const archivePath = path.join(resourcesDirectory, "app.asar");
await access(archivePath);

const entries = listPackage(archivePath, { isPack: false }).map((entry) =>
  entry.replaceAll("\\", "/"),
);
const fontEntries = entries.filter((entry) => entry.endsWith(".woff2"));
const rnnoiseBundled =
  entries.some((entry) => /\/dist\/assets\/rnnoiseProcessor\.worklet-.*\.js$/.test(entry)) &&
  entries.includes("/node_modules/@shiguredo/rnnoise-wasm/dist/rnnoise.js");

if (fontEntries.length === 0) throw new Error("Offline Noto Sans SC font was not bundled");
if (!rnnoiseBundled) throw new Error("RNNoise runtime was not found in the packaged renderer");

for (const licenseName of [
  "THIRD_PARTY_NOTICES.md",
  "rnnoise-wasm-APACHE-2.0.txt",
  "RNNOISE-BSD.txt",
  "NotoSansSC-OFL-1.1.txt",
]) {
  const licensePath = path.join(resourcesDirectory, "licenses", licenseName);
  await access(licensePath);
  if ((await readFile(licensePath, "utf8")).trim().length === 0) {
    throw new Error(`Packaged license is empty: ${licenseName}`);
  }
}

console.log(
  `Packaged runtime verified: ${fontEntries.length} font files, RNNoise runtime, and all licenses`,
);
