import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

test(
  "the hidden launcher parses in Windows PowerShell with spaces, Unicode and apostrophes",
  { skip: process.platform !== "win32" },
  async () => {
    const { developmentPowerShellScript } = createRequire(import.meta.url)(
      "../../../scripts/desktop-dev-shortcut.cjs",
    );
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
    await rm(path.join(directory, "dist-electron/main/app.cjs"));
    assert.equal(await developmentBundlesReady(directory), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
