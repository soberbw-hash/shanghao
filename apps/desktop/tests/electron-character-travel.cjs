/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "character-travel");
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
    cacheDir: path.join(app.getPath("userData"), "vite"),
    plugins: [react()], optimizeDeps: { noDiscovery: true, include: ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom/client", "framer-motion", "gsap", "lucide-react"] },
    server: { host: "127.0.0.1", port: 0, hmr: false } });
  await server.listen();
  window = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { backgroundThrottling: false } });
  let resultResolve, resultReject;
  const result = new Promise((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  const load = (async () => {
    deadline = setTimeout(() => resultReject(new Error("Motion regression timed out")), 60000);
    window.webContents.on("console-message", event => {
      if (event.message.startsWith("MOTION_RESULT:")) { console.log(event.message); resultResolve(); }
      if (event.message.startsWith("MOTION_FAILURE:") || event.level === "error") resultReject(new Error(event.message));
    });
    window.webContents.on("render-process-gone", (_event, details) => resultReject(new Error(JSON.stringify(details))));
    await window.loadURL(`${server.resolvedUrls.local[0]}tests/fixtures/character-travel.html`);
  })();
  await Promise.race([load.then(() => result), result]);
}).catch(error => { console.error(error); failed = true; }).finally(async () => {
  clearTimeout(deadline); window?.destroy(); await server?.close(); app.exit(failed ? 1 : 0);
});
