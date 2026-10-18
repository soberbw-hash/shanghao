/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, process, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "member-availability");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 820,
    height: 640,
    title: "上号 · 成员状态检查",
    webPreferences: { backgroundThrottling: false },
  });
  try {
    const file = path.join(__dirname, "visual/member-availability.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}`,
    );
    const result = await view.webContents.executeJavaScript(
      `(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<80&&!document.querySelector('.member-availability-controls');i++)await pause(50);
      await pause(2000);
      const check=(ok,message)=>{if(!ok)throw Error(message)};
      const characters=()=>[...document.querySelectorAll('.scene-character-motion')];
      check(characters().length===3,'member count mismatch');
      check(characters().every(el=>Number(getComputedStyle(el).opacity)>.4),'hidden member');
      document.querySelector('[title="吃饭中 · 静音麦克风"]').click(); await pause(2000);
      check(document.querySelector('#fixture-muted').textContent==='muted','status failed to mute');
      check(document.querySelector('.scene-availability-bubble')?.textContent.includes('吃饭中'),'missing persistent status');
      check(document.querySelector('.scene-availability-bubble').getBoundingClientRect().height>=24,'away status text was scaled too small');
      document.querySelector('#fixture-rerender').click();await pause(100);
      check(document.querySelector('.scene-availability-bubble')?.textContent.includes('吃饭中'),'snapshot erased status');
      for(const label of ['暂时离开','去厕所','吃饭中']) {
        document.querySelector('[title="'+label+' · 静音麦克风"]').click();await pause(150);
        check(characters()[0].querySelector('[data-scene-zone]').dataset.sceneZone==='gameDesk1','status moved character away from seat');
        check(document.querySelector('.scene-availability-bubble')?.textContent.includes(label),'wrong status label');
        check(document.querySelector('#fixture-muted').textContent==='muted','switching status opened microphone');
      }
      document.querySelector('[title="清除状态"]').click(); await pause(200);
      check(document.querySelector('#fixture-muted').textContent==='open','return did not restore previous mute choice');
      check(!document.querySelector('.scene-availability-bubble'),'status not cleared');
      check(characters().length===3&&characters().every(el=>Number(getComputedStyle(el).opacity)>.4),'member lost after movement');
      check(characters()[0].querySelector('[data-scene-zone]').dataset.sceneZone==='gameDesk1','clearing status changed seat');
      return {passed:true,members:characters().length,persistentStatus:true,mutedDuringStatus:true,allThreeStayAtSeat:true,restoredMicrophone:true};
    })()`,
      true,
    );
    await fs.writeFile(
      path.join(os.tmpdir(), "shanghao-member-availability-result.json"),
      JSON.stringify(result, null, 2),
    );
    await view.webContents.executeJavaScript(
      `document.querySelector('[title="吃饭中 · 静音麦克风"]').click();new Promise(resolve=>setTimeout(resolve,1600))`,
      true,
    );
    await fs.writeFile(
      path.join(os.tmpdir(), "shanghao-member-availability.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
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
