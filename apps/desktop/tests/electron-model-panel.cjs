/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console */
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
let server, window;
let failed = false;
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const { createServer } = await import("vite");
  const { default: react } = await import("@vitejs/plugin-react-swc");
  server = await createServer({ configFile: false, root: path.join(__dirname, ".."),
    resolve: { alias: { "@private-voice/shared": path.join(__dirname, "../../../packages/shared/src/index.ts") } },
    plugins: [react()], optimizeDeps: { entries: ["tests/fixtures/model-panel.html"] },
    server: { host: "127.0.0.1", port: 0 } });
  await server.listen();
  window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  window.webContents.on("console-message", (_event, details) => console.log(details.message));
  window.webContents.on("render-process-gone", (_event, details) => console.error(details));
  const evaluate = (source) => window.webContents.executeJavaScript(source);
  const waitFor = async (source) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(source)) return; await delay(100); }
    throw new Error(`UI condition timeout: ${source}`);
  };
  const click = async (label, scope = "document") => {
    const expression = `[...${scope}.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`;
    await waitFor(`Boolean(${expression}) && !(${expression}).disabled`);
    await evaluate(`(${expression}).click()`);
  };
  await window.loadURL(`${server.resolvedUrls.local[0]}tests/fixtures/model-panel.html`);
  await click("清除测试结果");
  await click("开始测试");
  await waitFor("document.querySelectorAll('.model-comparison-picker-grid button').length === 1");
  assert.equal(await evaluate("document.querySelector('.model-comparison-picker-grid button').getAttribute('aria-pressed')"), "true");
  await click("开始测试", "document.querySelector('[role=dialog]')");
  await click("继续未完成测试");
  await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '暂停')");
  console.log(JSON.stringify({ success: true, clearSelectStartFailureResume: "passed", backend: "fixture-only" }));
}).catch((error) => { console.error(error); failed = true; }).finally(async () => {
  window?.destroy(); await server?.close(); app.exit(failed ? 1 : 0);
});
