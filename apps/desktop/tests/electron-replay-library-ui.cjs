/* global require, process, console, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "replay-library-ui");
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  view.webContents.setAudioMuted(true);
  view.webContents.on("console-message", event => console.log(event.message));
  try {
    const file = path.resolve("tests/fixtures/replay-library.html").replaceAll("\\", "/");
    if (process.env.SHANGHAO_STATIC_UI === "1") await view.loadFile(path.resolve("../../artifacts/native-ui/replay-library.static.html"));
    else await view.loadURL(`http://127.0.0.1:5174/@fs/${file}`);
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms)),check=(ok,why)=>{if(!ok)throw Error(why)};
      const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
      for(let i=0;i<100&&!document.querySelector('.voice-replay-clips button');i++)await wait(50);
      document.querySelector('.voice-replay-clips button').click();await wait(100);
      check(!document.documentElement.dataset.transcribes,'transcription started without a click');
      button('本地转文字').click();button('本地转文字').click();await wait(130);
      check(document.documentElement.dataset.transcribes==='1','local transcription submitted twice');
      check(document.querySelector('[aria-label="本地转录文字"]')?.textContent.includes('合成本地文字'),'local transcript missing');
      const rename=button('保存名称');check(rename,'rename control missing');rename.click();rename.click();await wait(30);
      check(document.documentElement.dataset.renames==='1','rename submitted twice before re-render');
      button('片段库开关').click();await wait(30);
      const lists=document.documentElement.dataset.lists;
      document.dispatchEvent(new Event('fixture-finish-rename'));await wait(100);
      check(document.documentElement.dataset.lists===lists,'closed library made a late refresh request');
      check(document.documentElement.dataset.urls==='0','closing library leaked preview URL');
      button('片段库开关').click();await wait(100);
      document.querySelector('.voice-replay-clips button').click();await wait(80);
      check(document.querySelector('[aria-label="本地转录文字"]')?.textContent.includes('合成本地文字'),'saved local transcript missing after reopening');
      check(document.documentElement.dataset.transcribes==='1','reopening ran transcription again');
      button('导出').click();button('导出').click();await wait(130);
      check(document.documentElement.dataset.exports==='1','export opened twice');
      button('移到系统回收站').click();button('移到系统回收站').click();await wait(130);
      check(document.documentElement.dataset.removes==='1','delete submitted twice');
      check(document.querySelectorAll('.voice-replay-clips button').length===1,'delete result not rendered');
      document.querySelector('.voice-replay-clips button').click();await wait(80);
      const end=document.querySelector('.voice-replay-trim label:nth-child(2) input');
      check(end && Number(end.value)*1000<=1006,'default trim endpoint exceeds clip duration');
      button('另存裁剪').click();button('另存裁剪').click();await wait(140);
      check(document.documentElement.dataset.trims==='1','trim submitted twice');
      check(document.querySelectorAll('.voice-replay-clips button').length===2,'trim did not preserve original');
      check(document.querySelector('.voice-replay-clips .is-selected strong')?.textContent==='trimmed','trimmed result was not selected');
      button('片段库开关').click();await wait(30);check(document.documentElement.dataset.urls==='0','trim preview URL leaked');
      return {renameOnce:true,exportOnce:true,deleteOnce:true,trimOnce:true,closedPanelNoRefresh:true,previewUrlsReleased:true,originalPreserved:true};
    })()`);
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { view.destroy(); clearTimeout(deadline); app.exit(process.exitCode || 0); }
});
