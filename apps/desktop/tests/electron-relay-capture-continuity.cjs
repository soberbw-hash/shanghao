/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, __dirname, setTimeout */
const { app, BrowserWindow } = require("electron");
const { mkdtempSync, rmSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const profile = mkdtempSync(path.join(os.tmpdir(), "shanghao-relay-continuity-"));
app.setPath("userData", profile);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false },
  });
  try {
    const fixture = path
      .join(__dirname, "fixtures", "relay-capture-continuity.html")
      .replaceAll("\\", "/");
    await window.loadURL(`http://127.0.0.1:5173/@fs/${fixture}`);
    const result = await window.webContents.executeJavaScript("window.testRelayContinuity()");
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (
      result.coverage < 0.85 ||
      result.coverage > 1.15 ||
      !result.sampleRates.every((rate) => rate === 96000)
    )
      process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  } finally {
    window.destroy();
    app.exit(process.exitCode || 0);
  }
});
process.on("exit", () => {
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Chromium may briefly retain its isolated cache. */
  }
});
setTimeout(() => app.exit(1), 20000).unref();
