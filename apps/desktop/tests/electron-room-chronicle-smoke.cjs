/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "room-chronicle");
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 85_000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ width: 460, height: 780, show: false,
    webPreferences: { backgroundThrottling: false, offscreen: true } });
  view.webContents.on("console-message", (event) => {
    const message = event.message;
    if (message) console.log(String(message).slice(0, 500));
  });
  try {
    const file = path.join(__dirname, "visual/room-chronicle.html").replaceAll("\\", "/");
    if (process.env.SHANGHAO_STATIC_UI === "1") {
      await view.loadFile(path.resolve(__dirname, "../../../artifacts/native-ui/room-chronicle.static.html"));
    } else await view.loadURL(`${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5174"}/@fs/${file}`);
    const result = await view.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const check = (ok, reason) => { if (!ok) throw Error(reason); };
      for (let i=0; i<100 && !document.querySelector('[role="tab"]'); i++) await wait(50);
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      check(tabs.length===2, 'tabs missing');
      const headerTop = document.querySelector('.chat-panel-header').getBoundingClientRect().top;
      tabs[1].click(); await wait(150);
      const button = document.querySelector('button[aria-label="开始提供纪事语音"]');
      check(button && !button.disabled, 'start unavailable');
      button.click(); await wait(150);
      check(button.textContent.includes('停止'), 'participation did not start');
      tabs[0].click(); await wait(100);
      check(document.querySelector('.chat-composer'), 'chat composer lost');
      // Capture continues while looking at chat and while the test window is hidden.
      for (let i=0; i<750 && window.chronicleFixture.result.decodedParts<2; i++) await wait(100);
      check(window.chronicleFixture.result.decodedParts>=2, 'capture did not survive a second rollover');
      tabs[1].click(); await wait(250);
      check(document.querySelector('.room-chronicle-entries article'), 'summary missing');
      check(document.querySelector('.chat-panel-header').getBoundingClientRect().top===headerTop, 'quick messages moved');
      const row=document.querySelector('.room-chronicle-toolbar');
      check(row.scrollWidth<=row.clientWidth+1,'toolbar clipped');
      check(window.chronicleFixture.result.decodedSeconds>25, 'real codec duration invalid');
      document.querySelector('button[aria-label="停止提供纪事语音"]').click(); await wait(100);
      await window.chronicleFixture.close();
      check(window.chronicleFixture.result.inputStillLive, 'stopping chronicle stopped room voice');
      return { ok:true, ...window.chronicleFixture.result };
    })()`);
    const output = path.resolve(__dirname, "../../../artifacts/room-chronicle-rollover-20261101.png");
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, (await view.webContents.capturePage()).toPNG());
    console.log(JSON.stringify({ ...result, screenshot: output }));
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ ok:false, error:String(error) }));
    clearTimeout(deadline);
    app.exit(1);
  }
});
