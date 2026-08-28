// Only mirror an existing public GitHub Release. Never package the local desktop checkout.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const activate = args.includes("--activate");
const origin = "https://shanghao-d3ga95tc8224e727a-1315451893.tcloudbaseapp.com";
const cache = resolve(root, ".release-cache");
const manifestPath = resolve(cache, "release.json");
const headers = { Accept: "application/vnd.github+json", "User-Agent": "ShangHao-website-release-mirror" };

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

if (activate) {
  // Publish metadata only after the versioned installer has actually been uploaded.
  const release = JSON.parse(await readFile(manifestPath, "utf8"));
  for (const asset of release.assets) {
    const response = await fetch(`${origin}${asset.mirror_path}`, {
      method: "HEAD", signal: AbortSignal.timeout(30000),
    });
    if (!response.ok || Number(response.headers.get("content-length")) !== asset.size) {
      throw new Error("CloudBase installer is not ready; refusing to activate download link.");
    }
  }
  await writeFile(resolve(root, "public/release.json"), JSON.stringify(release, null, 2) + "\n");
  console.log(`Activated verified CloudBase download for ${release.tag_name}.`);
} else {
  const response = await fetch("https://api.github.com/repos/soberbw-hash/shanghao/releases/latest", {
    headers, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("Cannot read the latest public GitHub Release.");
  const release = await response.json();
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) {
    throw new Error("Only mirror published stable releases.");
  }
  const asset = release.assets.find((item) => /^ShangHao-[\d.]+-Setup-x64\.exe$/.test(item.name));
  const digest = asset?.digest?.match(/^sha256:([a-f0-9]{64})$/)?.[1];
  if (!asset || !digest || asset.size < 1 ||
      asset.browser_download_url !== `https://github.com/soberbw-hash/shanghao/releases/download/${release.tag_name}/${asset.name}`) {
    throw new Error("Missing official Windows installer or SHA-256; refusing to mirror.");
  }
  const directory = resolve(cache, release.tag_name);
  const installer = resolve(directory, asset.name);
  await mkdir(directory, { recursive: true });
  const existing = await stat(installer).catch(() => null);
  if (existing?.size !== asset.size || await sha256(installer) !== digest) {
    console.log(`Downloading public ${release.tag_name}: ${asset.name} (${asset.size} bytes)`);
    const download = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(600000) });
    if (!download.ok || !download.body) throw new Error("Installer download failed.");
    await pipeline(Readable.fromWeb(download.body), createWriteStream(installer));
  }
  if ((await stat(installer)).size !== asset.size || await sha256(installer) !== digest) {
    throw new Error("Installer hash/size mismatch. Do not upload this file.");
  }
  await writeFile(resolve(directory, "SHA256SUMS.txt"), `${digest}  ${asset.name}\n`);
  await writeFile(manifestPath, JSON.stringify({
    tag_name: release.tag_name,
    published_at: release.published_at,
    html_url: release.html_url,
    assets: [{ name: asset.name, size: asset.size, browser_download_url: asset.browser_download_url,
      mirror_path: `/downloads/${release.tag_name}/${asset.name}`, sha256: digest }],
  }, null, 2) + "\n");
  console.log(`Verified SHA-256 ${digest}. Upload ${directory} to downloads/${release.tag_name}, then run release:activate.`);
}
