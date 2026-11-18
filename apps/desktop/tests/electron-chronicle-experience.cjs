/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout, process */
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
      process.env.SHANGHAO_CHRONICLE_FIXTURE ||
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
        if(!text.includes('1/2 人参与转录')||!text.includes('语音发送至云端转录')||text.includes('空位')||text.includes('队友需在'))
          throw Error('speaker participation or cloud disclosure missing');
        if(panel.scrollWidth>panel.clientWidth+1) throw Error('chronicle overflows');
        const details=panel.querySelector('.chronicle-source-status');
        if(details.open) throw Error('status details should be collapsed');
        details.querySelector('summary').click();
        if(!details.open) throw Error('status details cannot be opened');
        const name=details.querySelector('#chronicle-display-name');
        const setValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
        setValue.call(name,'小尤'); name.dispatchEvent(new Event('input',{bubbles:true}));
        name.form.requestSubmit(); await new Promise(r=>setTimeout(r,20));
        if(localStorage.getItem('shanghao:chronicle-name:synthetic-profile')!=='小尤') throw Error('chronicle-only name not saved');
        details.querySelector('summary').click();
        if(panel.querySelector('.chronicle-reactions')) throw Error('obsolete reactions remain');
        const buttons=[...panel.querySelectorAll('.room-chronicle-toolbar > button')];
        if(!buttons[0].textContent.includes('保存刚才对话') || !buttons[1].textContent.includes('导出聊天纪事'))
          throw Error('export is not next to save');
        const bar=panel.querySelector('.room-chronicle-toolbar').getBoundingClientRect();
        const save=buttons[0].getBoundingClientRect(), exportButton=buttons[1].getBoundingClientRect();
        const statusLeft=details.getBoundingClientRect().left;
        if(Math.abs(save.left-bar.left)>1 || Math.abs(save.left-statusLeft)>1 || Math.abs(save.top-exportButton.top)>1)
          throw Error('save and export are not left aligned on the same row');
        if([...panel.querySelectorAll('article time')].some(time=>!/^[0-9]{1,2}:[0-9]{2}$/.test(time.textContent.trim())))
          throw Error('story time must only show hours and minutes');
        await document.fonts.ready;
        const story=panel.querySelector('article p'), storyStyle=getComputedStyle(story);
        if(!storyStyle.fontFamily.includes('HarmonyOS Sans SC') || storyStyle.fontSize!=='14px' ||
           storyStyle.fontWeight!=='400' || storyStyle.letterSpacing!=='normal')
          throw Error('story typography is not the intended readable Harmony style');
        if(![...document.fonts].some(face=>face.family==='HarmonyOS Sans SC' && face.weight==='400' && face.status==='loaded'))
          throw Error('Harmony regular font did not load');
        if(story.scrollWidth>story.clientWidth+1) throw Error('story text overflows');
        if(buttons[1].disabled) throw Error('export unavailable for stored stories');
        const before=window.chronicleFixture.result.exportRequests;
        buttons[1].click(); await new Promise(r=>setTimeout(r,50));
        if(window.chronicleFixture.result.exportRequests!==before+1) throw Error('export did not run');
        return {width:window.innerWidth,stories:panel.querySelectorAll('article').length,overflow:false,export:true};
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
