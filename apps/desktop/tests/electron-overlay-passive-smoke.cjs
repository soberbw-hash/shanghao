/* eslint-disable @typescript-eslint/no-require-imports */
/* global console, process, require, setTimeout, clearTimeout, __dirname */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const assert = require("node:assert/strict");
const { app, BaseWindow, BrowserWindow, screen } = require("electron");
// Test failures must be reported to the launcher, never a modal on the user's desktop.
process.on("uncaughtException", (error) => {
  console.error(error);
  app.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error(error);
  app.exit(1);
});

const temporary = fs.mkdtempSync(
  path.join(fs.realpathSync(os.tmpdir()), "shanghao-overlay-passive-"),
);
app.setPath("userData", temporary);
app.setPath("sessionData", temporary);
const { buildSync } = require(
  require.resolve("esbuild", {
    paths: [path.dirname(require.resolve("tsup"))],
  }),
);
const output = path.join(temporary, "main", "overlay.cjs");
fs.mkdirSync(path.join(temporary, "preload"), { recursive: true });
fs.writeFileSync(path.join(temporary, "preload", "overlay.cjs"), "");
buildSync({
  entryPoints: [path.join(__dirname, "../src/main/overlay-window.ts")],
  outfile: output,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
let cursorQueries = 0;
let topWrites = 0;
let modes = [];
const server = http.createServer((_request, response) =>
  response.end("<!doctype html><title>Isolated passive overlay probe</title>"),
);
let overlay;
const deadline = setTimeout(() => {
  overlay?.close();
  server.close();
  app.exit(1);
}, 15_000);

app.whenReady().then(async () => {
  let failed = false;
  try {
    const originalCursor = screen.getCursorScreenPoint;
    const originalTop = BrowserWindow.prototype.setAlwaysOnTop;
    const originalMouse = BrowserWindow.prototype.setIgnoreMouseEvents;
    screen.getCursorScreenPoint = (...args) => {
      cursorQueries += 1;
      return originalCursor.apply(screen, args);
    };
    BrowserWindow.prototype.setAlwaysOnTop = function (...args) {
      topWrites += 1;
      return originalTop.apply(this, args);
    };
    BrowserWindow.prototype.setIgnoreMouseEvents = function (ignore, options) {
      modes.push({ ignore, forward: options.forward });
      return originalMouse.call(this, ignore, options);
    };
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.VITE_DEV_SERVER_URL = `http://127.0.0.1:${server.address().port}`;
    // Resolve the dev URL only after the isolated fixture server has started.
    const { OverlayWindowController: Controller } = require(output);
    overlay = new Controller();
    overlay.setGameActive(true);
    overlay.show();
    const window = BrowserWindow.getAllWindows()[0];
    await new Promise((resolve) => window.webContents.once("did-finish-load", resolve));
    overlay.setInteractive(true);
    assert.equal(window.isFocusable(), false);
    assert.equal(window.isFocused(), false);
    assert.equal(window.isAlwaysOnTop(), true);
    if (process.platform === "win32") {
      assert.ok(window.getParentWindow() instanceof BaseWindow);
      assert.equal(window.getParentWindow().isVisible(), false);
      assert.equal(window.getParentWindow().isFocusable(), false);
      assert.equal(BrowserWindow.getAllWindows().length, 1);
    }
    assert.deepEqual(modes.at(-1), { ignore: true, forward: false });
    const initialTopWrites = topWrites;
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    assert.equal(cursorQueries, 0);
    assert.equal(topWrites, initialTopWrites);
    assert.equal(window.isFocused(), false);
    overlay.setGameActive(false);
    assert.ok(cursorQueries > 0);
    console.log(
      JSON.stringify({
        ok: true,
        nativePassiveOverlay: true,
        focusable: false,
        gameCursorQueries: 0,
        periodicTopWrites: 0,
        desktopHoverResumed: true,
        hiddenTaskbarOwner: process.platform === "win32",
      }),
    );
  } catch (error) {
    failed = true;
    console.error(error);
  } finally {
    clearTimeout(deadline);
    overlay?.close();
    assert.equal(BaseWindow.getAllWindows().length, 0);
    server.close();
    if (failed) app.exit(1);
    else app.quit();
  }
});
