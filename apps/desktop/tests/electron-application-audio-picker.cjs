/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "audio-picker-ui");
const timer = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    width: 1140,
    height: 820,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  try {
    const file = path
      .join(__dirname, "fixtures/application-audio-picker.html")
      .replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}`,
    );
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const wait=async(c,label)=>{for(let i=0;i<150;i++){if(c())return;await new Promise(r=>setTimeout(r,20));}throw Error(label)};
      const button=(text)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
      await wait(()=>document.querySelector('#open-picker'),'fixture');
      document.querySelector('#open-picker').focus();document.querySelector('#open-picker').click();
      await wait(()=>document.querySelector('dialog:modal'),'top layer');
      const d=document.querySelector('dialog');if(d.parentElement!==document.body)throw Error('not portalled');
      const r=d.getBoundingClientRect();if(!d.contains(document.elementFromPoint(r.right-30,r.top+80)))throw Error('chat covers dialog');
      if(!button('开始放歌').disabled)throw Error('unselected start enabled');
      document.querySelectorAll('.application-audio-source')[0].click();
      await wait(()=>document.querySelector('.application-audio-source[aria-pressed="true"] img')?.alt.includes('网易云'),'selected icon');
      if(document.querySelector('.application-audio-preview,canvas,video'))throw Error('audio picker contains a screen preview');
      if(button('开始放歌').disabled)throw Error('selected start disabled');
      document.querySelectorAll('.application-audio-source')[2].click();
      await wait(()=>document.querySelector('.application-audio-source[aria-pressed="true"] .application-audio-source-icon svg'),'missing icon fallback');
      window.pickerMode('loading');await wait(()=>document.querySelector('[role="status"]'),'loading');
      window.pickerMode('empty');await wait(()=>document.body.textContent.includes('暂未找到'),'empty');
      window.pickerMode('error');await wait(()=>document.querySelector('[role="alert"]'),'error');
      document.querySelector('[aria-label="刷新应用列表"]').click();await wait(()=>window.pickerEvidence.refreshed===1,'refresh');
      document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));await wait(()=>!document.querySelector('dialog'),'escape close');
      if(document.activeElement.id!=='open-picker')throw Error('focus did not return');
      document.querySelector('#open-picker').click();await wait(()=>document.querySelector('dialog:modal'),'reopen');
      window.pickerMode('busy');await wait(()=>button('取消开启'),'busy');button('取消开启').click();await wait(()=>window.pickerEvidence.stopped===1&&!document.querySelector('dialog'),'real cancel');
      document.querySelector('#open-picker').click();await wait(()=>document.querySelector('dialog:modal'),'reopen after cancel');
      document.querySelectorAll('.application-audio-source')[1].click();await wait(()=>document.querySelector('.application-audio-source[aria-pressed="true"] img'),'icon again');
      return {topLayer:true,portal:true,chatCannotOcclude:true,explicitSelection:true,iconsOnly:true,missingIconFallback:true,loadingEmptyError:true,refresh:true,escapeAndFocusReturn:true,busyCancellation:true};
    })()`);
    fs.writeFileSync(
      path.resolve(__dirname, "../../../artifacts/application-audio-icons-desktop.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
    view.setSize(460, 760);
    await view.webContents.executeJavaScript(`new Promise(r=>setTimeout(r,100))`);
    await view.webContents.executeJavaScript(
      `(()=>{const d=document.querySelector('dialog'),r=d.getBoundingClientRect();if(r.left<0||r.right>innerWidth||r.top<0||r.bottom>innerHeight||d.scrollWidth>d.clientWidth+1)throw Error('narrow overflow');})()`,
    );
    fs.writeFileSync(
      path.resolve(__dirname, "../../../artifacts/application-audio-icons-narrow.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
    console.log(JSON.stringify({ ...result, narrowViewport: true }));
    clearTimeout(timer);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(timer);
    app.exit(1);
  }
});
