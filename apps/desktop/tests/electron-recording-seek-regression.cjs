/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const profile = require("./electron-isolated-profile.cjs").configureIsolatedProfile(
  app,
  "recording-seek",
);
const esbuild = require(
  require.resolve("esbuild", { paths: [path.dirname(require.resolve("tsup"))] }),
);
const root = path.resolve(__dirname, "../../..");
const output = path.join(profile, "fixture.js");
esbuild.buildSync({
  entryPoints: [path.join(__dirname, "fixtures/recording-seek-regression.tsx")],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  define: { "import.meta.env": "{}" },
  alias: {
    "@private-voice/shared": path.join(root, "packages/shared/src/index.ts"),
    "@private-voice/ui": path.join(root, "packages/ui/src/index.ts"),
  },
});
const html = path.join(profile, "fixture.html");
fs.writeFileSync(
  html,
  '<meta charset="utf-8"><div id="root"></div><script type="module" src="./fixture.js"></script>',
);
const timeout = setTimeout(() => {
  console.error("isolated seek test timed out");
  app.exit(1);
}, 30_000);
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
    win.webContents.on("console-message", (event) => {
      if (!/^SEEK_(RESULT|FAILURE):/.test(event.message)) return;
      console.log(event.message);
      clearTimeout(timeout);
      app.exit(event.message.startsWith("SEEK_RESULT:") ? 0 : 1);
    });
    await win.loadFile(html);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
