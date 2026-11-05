/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(
  app,
  "recording-game-controller",
);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    const file = path
      .resolve("tests/fixtures/recording-game-controller.html")
      .replaceAll("\\", "/");
    await view.loadURL(`http://127.0.0.1:5173/@fs/${file}`);
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<100&&!document.querySelector('#start');i++)await wait(30);
      document.querySelector('#start').click();await wait(350);
      document.querySelector('#change').click();await wait(350);
      document.querySelector('#stop').click();
      for(let i=0;i<150&&!document.documentElement.dataset.finished;i++)await wait(40);
      const t=window.fixtureTimeline;
      if(document.documentElement.dataset.finished!=='yes'||!t?.complete||t.roomId!=='room-a'||t.events.length!==2||t.events[0].gameName!=='英雄联盟'||t.events[1].gameName!=='CS2'||t.events.some(e=>e.memberId!=='account-a')||t.events[1].offsetMs<=0||t.events[1].offsetMs>=t.durationMs)throw Error('recording game timeline not finalized correctly');
      const track=window.fixtureTracks[0];
      if(!track||track.startMs>t.events[1].offsetMs||track.endMs<t.events[1].offsetMs||Math.abs(track.endMs-t.durationMs)>1000)throw Error('timeline does not share audio track clock');
      return {actualRecorder:true,events:t.events.length,roomBound:true,memberBound:true,changeTimed:true,sharedTrackClock:true};
    })()`);
    console.log(JSON.stringify(result));
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
