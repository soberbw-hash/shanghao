/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "muted-speech");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false, offscreen: true },
  });
  view.webContents.on("console-message", (event) => console.log(event.message));
  try {
    const file = path.join(__dirname, "fixtures/muted-speech-reminder.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5196"}/@fs/${file}`,
    );
    await view.webContents.executeJavaScript(
      `(async()=>{for(let i=0;i<100;i++){if(window.fixtureReady)return;await new Promise(r=>setTimeout(r,40));}throw Error('fixture not ready')})()`,
    );
    const result = await view.webContents.executeJavaScript(
      `window.runMutedSpeechProbe().then(result=>({ok:true,...result}),error=>({ok:false,error:error.message}))`,
    );
    console.log(JSON.stringify(result));
    clearTimeout(deadline);
    view.destroy();
    app.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
