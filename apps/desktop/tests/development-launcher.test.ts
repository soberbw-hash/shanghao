import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

test(
  "the hidden launcher parses in Windows PowerShell with spaces, Unicode and apostrophes",
  { skip: process.platform !== "win32" },
  async () => {
    const { developmentPowerShellScript, developmentLauncherArguments } = createRequire(
      import.meta.url,
    )("../../../scripts/desktop-dev-shortcut.cjs");
    const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-launcher-syntax-"));
    try {
      const launcher = path.join(directory, "launch-dev.ps1");
      const body = developmentPowerShellScript(
        "C:\\Apps\\O'Brien\\上号",
        "C:\\My Project\\上号",
        "C:\\Launcher Files",
      );
      await writeFile(
        launcher,
        Buffer.concat([Buffer.from([255, 254]), Buffer.from(body, "utf16le")]),
      );
      const parseCommand = `$taskTokens=$null; $taskErrors=$null; [System.Management.Automation.Language.Parser]::ParseFile('${launcher.replaceAll("'", "''")}',[ref]$taskTokens,[ref]$taskErrors) | Out-Null; if($taskErrors.Count){$taskErrors | Write-Error; exit 1}`;
      execFileSync(
        path.join(
          process.env.SystemRoot ?? "C:/Windows",
          "System32/WindowsPowerShell/v1.0/powershell.exe",
        ),
        ["-NoProfile", "-NonInteractive", "-Command", parseCommand],
        { windowsHide: true, timeout: 10000, stdio: "pipe" },
      );
      assert.equal(body.includes("ExecutionPolicy"), false);
      assert.match(body, /IsInRole.*Administrator/);
      assert.match(body, /-Verb RunAs -WindowStyle Hidden/);
      const args = developmentLauncherArguments("C:\\Launcher Files");
      assert.ok(args.length < 900);
      const bootstrap = Buffer.from(args.split("-EncodedCommand ")[1], "base64").toString(
        "utf16le",
      );
      assert.match(bootstrap, /ReadAllText\('C:\\Launcher Files\\launch-dev.ps1'\)/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("a live renderer cannot make an incomplete Electron build ready to launch", async () => {
  // @ts-expect-error JavaScript launcher helper is shared with the standalone Node entry.
  const { developmentBundlesReady } = await import("../../../scripts/desktop-dev-runtime.mjs");
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-dev-launcher-"));
  try {
    await mkdir(path.join(directory, "dist-electron/main"), { recursive: true });
    await mkdir(path.join(directory, "dist-electron/preload"), { recursive: true });
    await writeFile(path.join(directory, "dist-electron/main/index.cjs"), "valid entry");
    assert.equal(await developmentBundlesReady(directory), false);
    await writeFile(path.join(directory, "dist-electron/main/app.cjs"), "valid app");
    await writeFile(path.join(directory, "dist-electron/preload/index.cjs"), "");
    assert.equal(await developmentBundlesReady(directory), false);
    await writeFile(path.join(directory, "dist-electron/preload/index.cjs"), "valid preload");
    assert.equal(await developmentBundlesReady(directory), false);
    await writeFile(path.join(directory, "dist-electron/preload/overlay.cjs"), "valid overlay");
    assert.equal(await developmentBundlesReady(directory), false);
    await writeFile(
      path.join(directory, "dist-electron/preload/screen-share-viewer.cjs"),
      "valid viewer",
    );
    assert.equal(await developmentBundlesReady(directory), true);
    await mkdir(path.join(directory, "src/main"), { recursive: true });
    const source = path.join(directory, "src/main/fixture.ts");
    await writeFile(source, "export const current = true;");
    const changedAt = new Date(Date.now() + 2000);
    await utimes(source, changedAt, changedAt);
    assert.equal(
      await developmentBundlesReady(directory),
      false,
      "a live renderer cannot hide stale Main bundles",
    );
    for (const file of [
      "main/index.cjs",
      "main/app.cjs",
      "preload/index.cjs",
      "preload/overlay.cjs",
      "preload/screen-share-viewer.cjs",
    ])
      await utimes(path.join(directory, "dist-electron", file), changedAt, changedAt);
    assert.equal(await developmentBundlesReady(directory), true);
    await rm(path.join(directory, "dist-electron/main/app.cjs"));
    assert.equal(await developmentBundlesReady(directory), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared protocol and build-configuration changes invalidate all development runtime bundles", async () => {
  // @ts-expect-error JavaScript launcher helper is shared with the standalone Node entry.
  const { developmentBundlesReady } = await import("../../../scripts/desktop-dev-runtime.mjs");
  const workspace = await mkdtemp(path.join(os.tmpdir(), "shanghao-dev-dependencies-"));
  const desktop = path.join(workspace, "apps/desktop");
  try {
    for (const name of [
      "main/index.cjs",
      "main/app.cjs",
      "preload/index.cjs",
      "preload/overlay.cjs",
      "preload/screen-share-viewer.cjs",
    ]) {
      const file = path.join(desktop, "dist-electron", name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "fixture");
    }
    const old = new Date(Date.now() - 10000),
      future = new Date(Date.now() + 10000);
    const shared = path.join(workspace, "packages/shared/src/ipc.ts");
    await mkdir(path.dirname(shared), { recursive: true });
    await writeFile(shared, "fixture");
    await utimes(shared, old, old);
    assert.equal(await developmentBundlesReady(desktop), true);
    await utimes(shared, future, future);
    assert.equal(await developmentBundlesReady(desktop), false);
    await utimes(shared, old, old);
    const protocol = path.join(workspace, "packages/signaling/src/protocol.ts");
    await mkdir(path.dirname(protocol), { recursive: true });
    await writeFile(protocol, "fixture");
    await utimes(protocol, future, future);
    assert.equal(await developmentBundlesReady(desktop), false);
    await utimes(protocol, old, old);
    const config = path.join(desktop, "tsup.config.ts");
    await writeFile(config, "fixture");
    await utimes(config, future, future);
    assert.equal(await developmentBundlesReady(desktop), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
