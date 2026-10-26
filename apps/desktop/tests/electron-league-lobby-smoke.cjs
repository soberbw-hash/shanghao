/* global require, __dirname, process, console, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require("electron");
const path = require("node:path"),
  fs = require("node:fs/promises");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "league-lobby");
const deadline = setTimeout(() => app.exit(1), 25000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    width: 420,
    height: 300,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  try {
    const file = path.join(__dirname, "visual/league-lobby.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}`,
    );
    await view.webContents.executeJavaScript(`(async()=>{
      const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
      const check=(value,message)=>{if(!value)throw Error(message)};
      for(let i=0;i<100&&!document.querySelector('.scene-league-lobby');i++)await pause();
      check(document.querySelector('.scene-league-lobby-count')?.textContent==='1/5','missing actual occupancy');
      check(document.querySelectorAll('[data-occupied=true]').length===1,'wrong occupied slots');
      check(document.querySelector('.scene-game-identity')?.textContent==='英雄联盟','game identity changed');
    })()`);
    const output = path.resolve(__dirname, "../../../artifacts/league-lobby-preview.png");
    await fs.writeFile(output, (await view.webContents.capturePage()).toPNG());
    await view.webContents.executeJavaScript(`(async()=>{
      const pause=()=>new Promise(resolve=>setTimeout(resolve,80));
      const check=(value,message)=>{if(!value)throw Error(message)};
      const click=text=>[...document.querySelectorAll('button')].find(el=>el.textContent===text).click();
      click('two');await pause();check(document.querySelectorAll('[data-occupied=true]').length===2,'occupancy failed to update');
      click('queue');await pause();check(document.querySelector('.scene-league-lobby-heading').textContent==='正在匹配','queue picture stale');
      click('game');await pause();check(!document.querySelector('.scene-league-lobby'),'stale lobby in game');check(document.querySelector('.scene-game-screenshot'),'game picture did not return');
      check(document.querySelector('.scene-game-identity').textContent==='英雄联盟','badge changed');
    })()`);
    console.log(
      JSON.stringify({
        lobby: true,
        occupancyUpdates: true,
        queueTransition: true,
        gameTransition: true,
        badgePreserved: true,
        isolatedProfile: true,
      }),
    );
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    view.destroy();
    app.exit(1);
  }
});
