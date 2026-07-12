import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const releaseDirectory = path.resolve(import.meta.dirname, "..", "apps", "desktop", "release");
const desktopPackage = JSON.parse(
  await readFile(
    path.resolve(import.meta.dirname, "..", "apps", "desktop", "package.json"),
    "utf8",
  ),
);
const versionMarker = `-${desktopPackage.version}-`;
const names = (await readdir(releaseDirectory))
  .filter(
    (name) =>
      ((name.endsWith(".exe") || name.endsWith(".blockmap")) && name.includes(versionMarker)) ||
      /^latest.*\.ya?ml$/i.test(name),
  )
  .sort((left, right) => left.localeCompare(right));

if (names.length === 0) throw new Error("No release assets found for checksum generation");

const lines = [];
for (const name of names) {
  const content = await readFile(path.join(releaseDirectory, name));
  lines.push(`${createHash("sha256").update(content).digest("hex")} *${name}`);
}
await writeFile(path.join(releaseDirectory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
console.log(`Generated SHA256SUMS.txt for ${names.length} release assets`);
