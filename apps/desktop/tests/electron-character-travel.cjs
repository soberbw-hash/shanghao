/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-background-timer-throttling");
let server, window, deadline;
let failed = false;
app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const { createServer } = await import("vite");
  const { default: react } = await import("@vitejs/plugin-react-swc");
  server = await createServer({ configFile: false, root: path.join(__dirname, ".."),
    resolve: { alias: { "@private-voice/shared": path.join(__dirname, "../../../packages/shared/src/index.ts") } },
    plugins: [react()], optimizeDeps: { entries: ["tests/fixtures/character-travel.html"] },
    server: { host: "127.0.0.1", port: 0, hmr: false } });
  await server.listen();
  window = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { backgroundThrottling: false } });
  const result = new Promise((resolve, reject) => {
    deadline = setTimeout(() => reject(new Error("Motion regression timed out")), 120000);
    window.webContents.on("console-message", event => {
      if (event.message.startsWith("MOTION_RESULT:")) { console.log(event.message); resolve(); }
      if (event.message.startsWith("MOTION_FAILURE:")) reject(new Error(event.message));
    });
    window.webContents.on("render-process-gone", (_event, details) => reject(new Error(JSON.stringify(details))));
  });
  await window.loadURL(`${server.resolvedUrls.local[0]}tests/fixtures/character-travel.html`);
  await result;
}).catch(error => { console.error(error); failed = true; }).finally(async () => {
  clearTimeout(deadline); window?.destroy(); await server?.close(); app.exit(failed ? 1 : 0);
});
