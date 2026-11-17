import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createPackageWithOptions, extractFile, listPackage } from "@electron/asar";

// A disposable ASAR, not an application installer. Never reads the user's profile.
const require = createRequire(import.meta.url);
const asarRequire = createRequire(require.resolve("@electron/asar"));
const { minimatch } = asarRequire("minimatch");
const names = [
  "main.js",
  "settings.json",
  "resources/icon.png",
  "resources/native.node",
  "assets/音效.txt",
  ".hidden",
  "nested/cache/test.map",
  "node_modules/demo/index.js",
];
const patterns = [
  "**/*",
  "**/*.node",
  "{resources,assets}/**/*",
  "**/node_modules/**",
  "**/*.map",
  "*.json",
];
const actual = patterns.map((pattern) => ({
  pattern,
  matches: names.filter((name) => minimatch(name, pattern, { dot: true })),
}));
const baseline = process.env.SHANGHAO_GLOB_BASELINE;
if (!baseline) throw Error("baseline_path_required");
if (process.argv.includes("--record-baseline"))
  await writeFile(baseline, JSON.stringify(actual), { flag: "wx" });
else assert.deepEqual(actual, JSON.parse(await readFile(baseline, "utf8")));

const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-asar-check-"));
try {
  const source = path.join(root, "source");
  for (const name of names) {
    const file = path.join(source, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "synthetic:" + name);
  }
  const archive = path.join(root, "synthetic.asar");
  await createPackageWithOptions(source, archive, { unpack: "**/*.node", dot: true });
  assert.equal(
    await readFile(path.join(archive + ".unpacked", "resources", "native.node"), "utf8"),
    "synthetic:resources/native.node",
  );
  const files = listPackage(archive).map((file) => file.replaceAll("\\", "/").replace(/^\//, ""));
  for (const name of names) {
    assert.ok(files.includes(name), name);
    assert.equal(extractFile(archive, path.normalize(name)).toString(), "synthetic:" + name);
  }
  console.log(
    JSON.stringify({
      passed: true,
      patterns: patterns.length,
      files: names.length,
      unpackedNative: true,
      syntheticOnly: true,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
