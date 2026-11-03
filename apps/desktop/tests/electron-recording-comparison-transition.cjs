/* global require, __dirname, process, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "recording-comparison-transition");
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 45000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false } });
  try {
    const fixture = path.join(__dirname, "fixtures/recording-library-feedback.html").replaceAll("\\", "/");
    await win.loadURL(`http://127.0.0.1:5174/@fs/${fixture}`);
    await win.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let i = 0; i < 150 && !document.querySelector('[aria-label="对比这条录音的转录模型"]'); i++) await wait(40);
      const button = document.querySelector('[aria-label="对比这条录音的转录模型"]');
      if (!button) throw Error('comparison button missing');
      const original = window.desktopApi.ai.getSnapshot;
      window.desktopApi.ai.getSnapshot = async (...args) => { await wait(300); return original(...args); };
      for (let i = 0; i < 6; i++) {
        button.click(); await wait(20);
        if (!document.querySelector('[aria-busy="true"][aria-label="录音模型对比"]')) throw Error('comparison loading state missing');
        if (document.querySelector('.voice-memory-detail')) throw Error('old detail remains visible');
        button.click(); await wait(20);
        if (document.querySelector('.model-comparison-panel') || !document.querySelector('.voice-memory-detail')) throw Error('wrong view after rapid return');
      }
      button.click(); await wait(450);
      if (!document.querySelector('.model-comparison-panel') || document.querySelector('[aria-busy="true"][aria-label="录音模型对比"]')) throw Error('comparison did not finish loading');
      button.click(); await wait(400);
      if (!document.querySelector('.voice-memory-detail') || document.querySelector('.model-comparison-panel')) throw Error('late result replaced recording detail');
    })()`);
    process.stdout.write("comparison rapid switching passed\n");
    clearTimeout(deadline); app.exit(0);
  } catch (error) { process.stderr.write(String(error.stack || error)); clearTimeout(deadline); app.exit(1); }
});
