/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(
  app,
  "automatic-settings-optout",
);
const deadline = setTimeout(() => app.exit(1), 15000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 1450,
    height: 1000,
    webPreferences: { backgroundThrottling: false },
  });
  try {
    const file = path.join(__dirname, "visual/settings-feedback.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}?unconfigured=1`,
    );
    const result = await view.webContents.executeJavaScript(
      `(async()=>{
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      for(let i=0;i<80&&!document.querySelector('button[aria-label="自动整理"]');i++)await pause(50);
      await pause(100);
      for(const label of ['自动转录','自动整理']){
        const button=document.querySelector('button[aria-label="'+label+'"]');
        if(!button||button.disabled||button.getAttribute('aria-pressed')!=='true')throw Error('unconfigured active switch cannot be disabled: '+label);
        button.click();await pause(40);
        if(button.getAttribute('aria-pressed')!=='false'||!button.disabled)throw Error('unconfigured switch did not preserve opt-out: '+label);
      }
      return {passed:true,unconfiguredAutomationCanBeDisabled:true};
    })()`,
      true,
    );
    console.log(JSON.stringify(result));
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
