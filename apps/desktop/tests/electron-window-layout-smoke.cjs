/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout */
const { app, BrowserWindow, screen } = require("electron");
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "window-layout");
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 10_000);
app.whenReady().then(() => {
  try {
    const ts = require("typescript");
    const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/main/window-layout.ts"), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } });
    const unit = { exports: {} };
    new Function("module", "exports", compiled.outputText)(unit, unit.exports);
    const display = screen.getPrimaryDisplay();
    const work = display.workArea;
    const fitted = unit.exports.fitMainWindow(work, unit.exports.normalizeSavedWindowBounds({ width: 99999, height: 99999 }));
    const view = new BrowserWindow({ ...fitted, show: false, frame: false });
    const actual = view.getBounds();
    assert.ok(actual.x >= work.x && actual.y >= work.y);
    assert.ok(actual.x + actual.width <= work.x + work.width);
    assert.ok(actual.y + actual.height <= work.y + work.height);
    if (work.width > 1120 && work.height > 720) assert.ok(actual.width < work.width && actual.height < work.height);
    assert.equal(view.isMaximized(), false);
    assert.equal(view.webContents.getZoomFactor(), 1);
    console.log(JSON.stringify({ ok: true, scaleFactor: display.scaleFactor, workArea: work, actual, maximized: false, zoom: 1 }));
    view.destroy();
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error(String(error));
    clearTimeout(deadline);
    app.exit(1);
  }
});
