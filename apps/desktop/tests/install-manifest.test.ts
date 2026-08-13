import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { MANIFEST_HEADER, writeInstallManifest } = require("../scripts/install-manifest.cjs") as {
  MANIFEST_HEADER: string;
  writeInstallManifest: (root: string) => Promise<{ files: number; directories: number }>;
};

test("Windows install manifest inventories only packaged files with safe relative paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-manifest-"));
  try {
    await mkdir(path.join(root, "resources", "assets"), { recursive: true });
    await writeFile(path.join(root, "ShangHao.exe"), "app");
    await writeFile(path.join(root, "resources", "app.asar"), "asar");
    await writeFile(path.join(root, "resources", "assets", "voice.wasm"), "wasm");

    const counts = await writeInstallManifest(root);
    const manifest = await readFile(path.join(root, ".shanghao-install-manifest"), "utf8");

    assert.deepEqual(counts, { files: 3, directories: 2 });
    assert.equal(manifest.startsWith(`${MANIFEST_HEADER}\r\n`), true);
    assert.equal(manifest.includes("F|ShangHao.exe"), true);
    assert.equal(manifest.includes("F|resources\\app.asar"), true);
    assert.equal(manifest.includes("D|resources\\assets"), true);
    assert.equal(manifest.includes(".."), false);
    assert.equal(manifest.includes(root), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("NSIS cleanup validates marker and manifest paths without deleting the install root", async () => {
  const installer = await readFile(new URL("../build/installer.nsh", import.meta.url), "utf8");
  assert.match(installer, /\.shanghao-install-manifest/);
  assert.match(installer, /ShangHao\.InstallManifest\.v1|StartsWith\('F\|'\)/);
  assert.match(installer, /GetFullPath/);
  assert.match(installer, /StringComparison\]::OrdinalIgnoreCase/);
  assert.match(installer, /Remove-Item -LiteralPath/);
  assert.doesNotMatch(installer, /Remove-Item[^\r\n]+-Recurse/);
  assert.doesNotMatch(installer, /RMDir\s+\/r\s+"\$INSTDIR"/);
});
