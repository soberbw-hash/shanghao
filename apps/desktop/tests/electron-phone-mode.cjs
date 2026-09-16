/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");
const { setTimeout: delay } = require("node:timers/promises");
let window,
  failed = false;
app.on("window-all-closed", () => {});
app
  .whenReady()
  .then(async () => {
    const { build } = await import("vite"),
      { default: react } = await import("@vitejs/plugin-react-swc");
    const output = mkdtempSync(path.join(tmpdir(), "phone-ui-built-"));
    await build({
      configFile: false,
      base: "./",
      root: path.join(__dirname, ".."),
      plugins: [react()],
      resolve: {
        alias: {
          "@private-voice/shared": path.join(__dirname, "../../../packages/shared/src/index.ts"),
        },
      },
      build: {
        outDir: output,
        target: "esnext",
        rollupOptions: { input: path.join(__dirname, "fixtures/phone-mode.html") },
      },
    });
    window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    window.webContents.on("console-message", (event, ...args) =>
      console.log(event.message ?? args[1] ?? args),
    );
    const evaluate = (source) => window.webContents.executeJavaScript(source);
    await Promise.race([
      window.loadFile(path.join(output, "tests/fixtures/phone-mode.html")),
      delay(20000).then(() => {
        throw new Error("UI load timeout");
      }),
    ]);
    for (let i = 0; i < 100; i++) {
      if (await evaluate("!!document.querySelector('[aria-label=电话模式触发方式]')")) break;
      await delay(100);
    }
    assert.equal(await evaluate("!!document.querySelector('button[aria-pressed]')"), false);
    assert.equal(
      await evaluate("document.querySelector('[aria-label=电话模式触发方式]').options.length"),
      2,
    );
    assert.equal(
      await evaluate("document.querySelector('[aria-label=电话模式触发方式]').options[0].text"),
      "按住快捷键",
    );
    assert.equal(
      await evaluate("document.querySelector('[aria-label=电话模式触发方式]').options[1].text"),
      "按一次切换",
    );
    assert.equal(
      await evaluate("document.querySelector('[aria-label=电话模式触发方式]').classList.contains('device-select')"),
      false,
    );
    await evaluate(`(() => {
      const input = document.querySelector('input'); input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    })()`);
    await delay(100);
    assert.equal(await evaluate("document.querySelector('input').value"), "空格");
    for (const [button, label] of [[3, "鼠标侧键 1"], [4, "鼠标侧键 2"]]) {
      await evaluate("document.querySelector('input').blur(); document.querySelector('input').focus()");
      await delay(50);
      await evaluate(`document.querySelector('input').dispatchEvent(new MouseEvent('mousedown', { button: ${button}, bubbles: true }))`);
      await delay(100);
      assert.equal(await evaluate("document.querySelector('input').value"), label);
    }
    console.log(
      JSON.stringify({
        entry: true,
        homeEntryRemoved: true,
        holdToggleChoices: true,
        spaceAndSideButtons: true,
        backend: "fixture-only",
      }),
    );
  })
  .catch((error) => {
    console.error(error);
    failed = true;
  })
  .finally(() => {
    window?.destroy();
    app.exit(failed ? 1 : 0);
  });
