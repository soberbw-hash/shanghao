/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "chronicle-experience");
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 25000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    width: 460,
    height: 860,
    webPreferences: { backgroundThrottling: false, offscreen: true },
  });
  view.webContents.setAudioMuted(true);
  let lastFrame;
  view.webContents.on("paint", (_event, _rect, frame) => {
    lastFrame = frame;
  });
  view.webContents.setFrameRate(30);
  view.webContents.startPainting();
  try {
    await view.loadFile(
      path.resolve(__dirname, "../../../artifacts/native-ui/room-chronicle.static.html"),
    );
    await view.webContents.executeJavaScript(`(async()=>{
      for(let i=0;i<100&&!window.chronicleFixture;i++) await new Promise(r=>setTimeout(r,30));
      window.chronicleFixture.preview();
      await new Promise(r=>setTimeout(r,100));
      document.querySelectorAll('[role="tab"]')[1].click();
    })()`);
    const checks = [];
    for (const width of [360, 460, 760]) {
      view.webContents.enableDeviceEmulation({
        screenPosition: "desktop",
        screenSize: { width, height: 860 },
        viewSize: { width, height: 860 },
        deviceScaleFactor: 1,
        scale: 1,
      });
      checks.push(
        await view.webContents.executeJavaScript(`(async()=>{
        await new Promise(r=>setTimeout(r,180));
        document.querySelectorAll('[role="tab"]')[1].click();
        await new Promise(r=>setTimeout(r,220));
        const panel=document.querySelector('.room-chronicle');
        if(panel.closest('[role="tabpanel"]').getAttribute('aria-hidden')!=='false')
          throw Error('chronicle is not the visible tab');
        const text=panel.textContent;
        if(!text.includes('1/2 人参与转录')||!text.includes('语音发送至云端转录')||!text.includes('约2分钟')||text.includes('空位')||text.includes('队友需在'))
          throw Error('speaker participation or cadence not visible');
        if(panel.scrollWidth>panel.clientWidth+1) throw Error('chronicle overflows');
        const reactions=[...panel.querySelectorAll('.chronicle-reactions button')];
        if(reactions.length!==4) throw Error('story reactions unavailable');
        reactions[0].click(); await new Promise(r=>setTimeout(r,50));
        if(reactions[0].getAttribute('aria-pressed')!=='true') throw Error('reaction not retained');
        reactions[0].click(); await new Promise(r=>setTimeout(r,50));
        return {width:window.innerWidth,stories:panel.querySelectorAll('article').length,overflow:false,feedback:true};
      })()`),
      );
    }
    view.webContents.enableDeviceEmulation({
      screenPosition: "desktop",
      screenSize: { width: 460, height: 860 },
      viewSize: { width: 460, height: 860 },
      deviceScaleFactor: 1,
      scale: 1,
    });
    await view.webContents.executeJavaScript(
      `(async()=>{ document.querySelectorAll('[role="tab"]')[1].click(); await new Promise(r=>setTimeout(r,250)); })()`,
    );
    await fs.writeFile(
      path.resolve(__dirname, "../../../artifacts/chronicle-experience-20261111.png"),
      lastFrame.toPNG(),
    );
    await view.webContents.executeJavaScript("window.chronicleFixture.close()");
    console.log(JSON.stringify({ passed: true, checks }));
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error(String(error.stack));
    clearTimeout(deadline);
    app.exit(1);
  }
});
