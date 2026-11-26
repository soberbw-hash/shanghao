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
    if (process.env.SHANGHAO_TEST_ORIGIN) {
      const file = path.join(__dirname, "visual/room-chronicle.html").replaceAll("\\", "/");
      await view.loadURL(`${process.env.SHANGHAO_TEST_ORIGIN}/@fs/${file}`);
    } else {
      await view.loadFile(
        process.env.SHANGHAO_CHRONICLE_FIXTURE ||
          path.resolve(__dirname, "../../../artifacts/native-ui/room-chronicle.static.html"),
      );
    }
    view.webContents.debugger.attach();
    await view.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {
      enabled: true,
    });
    await view.webContents.executeJavaScript(`(async()=>{
      for(let i=0;i<100&&!window.chronicleFixture;i++) await new Promise(r=>setTimeout(r,30));
      await new Promise(r=>setTimeout(r,100));
      document.querySelectorAll('[role="tab"]')[1].click();
      await new Promise(r=>setTimeout(r,100));
      const status=document.querySelector('.chronicle-source-status');
      const info=status.querySelector('button');
      const tooltip=document.getElementById(info.getAttribute('aria-describedby'));
      if(!status.textContent.includes('转录未开启')||status.textContent.includes('查看说明')||status.querySelector('summary'))
        throw Error('inactive status still has a disclosure');
      if(getComputedStyle(tooltip).visibility!=='hidden') throw Error('tooltip is visible at rest');
      const rowHeight=status.getBoundingClientRect().height;
      info.focus();
      await new Promise(r=>setTimeout(r,20));
      if(getComputedStyle(tooltip).visibility!=='visible'||!tooltip.textContent.includes('语音发送至云端转录'))
        throw Error('keyboard focus cannot reveal the transcription explanation');
      if(status.getBoundingClientRect().height!==rowHeight) throw Error('tooltip pushes the list down');
      info.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      await new Promise(r=>setTimeout(r,50));
      if(getComputedStyle(tooltip).visibility!=='hidden') throw Error('Escape does not dismiss the explanation');
      info.blur();
      window.chronicleFixture.preview();
    })()`);
    const iconPoint = await view.webContents.executeJavaScript(`(() => {
      const rect = document.querySelector('.chronicle-source-info').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await view.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      ...iconPoint,
    });
    if (
      !(await view.webContents.executeJavaScript(
        "getComputedStyle(document.querySelector('.chronicle-source-tooltip')).visibility === 'visible'",
      ))
    )
      throw Error("pointer hover cannot reveal the transcription explanation");
    await view.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 1,
      y: 1,
    });
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
        const status=panel.querySelector('.chronicle-source-status');
        const info=status.querySelector('button');
        const tooltip=document.getElementById(info.getAttribute('aria-describedby'));
        info.focus();
        await new Promise(r=>setTimeout(r,20));
        if(getComputedStyle(tooltip).visibility!=='visible'||!tooltip.textContent.includes('参与：林小川'))
          throw Error('room memory alias not shown in the explanation: '+tooltip.textContent+' / '+getComputedStyle(tooltip).visibility+' / '+(document.activeElement===info));
        const description=tooltip.querySelector('.chronicle-source-tooltip-line');
        if(description.getBoundingClientRect().height>Math.ceil(parseFloat(getComputedStyle(description).lineHeight)))
          throw Error('transcription explanation wrapped');
        info.blur();
        if(status.querySelector('input, summary')) throw Error('obsolete status controls remain');
        if(!panel.querySelector('article p').textContent.startsWith('林小川说这把稳了'))
          throw Error('room memory alias not applied to existing entry');
        if(panel.querySelector('.chronicle-reactions')) throw Error('obsolete reactions remain');
        const buttons=[...panel.querySelectorAll('.room-chronicle-toolbar > button')];
        if(!buttons[0].textContent.includes('保存刚才对话') || !buttons[1].textContent.includes('导出聊天纪事'))
          throw Error('export is not next to save');
        const bar=panel.querySelector('.room-chronicle-toolbar').getBoundingClientRect();
        const save=buttons[0].getBoundingClientRect(), exportButton=buttons[1].getBoundingClientRect();
        const statusLeft=status.getBoundingClientRect().left;
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
      path.join(app.getPath("userData"), "chronicle-experience.png"),
      lastFrame.toPNG(),
    );
    const dailyHistory = await view.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const fixture=window.chronicleFixture;
      const day="2026-11-20", following="2026-11-21";
      const entry={id:"server-today", at:Date.parse(day+"T23:59:00+08:00"), text:"当天服务器纪事"};
      fixture.setServerDay(day, [entry]);
      await pause(80);
      const panel=document.querySelector('.room-chronicle');
      const stories=()=>[...panel.querySelectorAll('article p')].map(p=>p.textContent);
      if(stories().join()!==entry.text) throw Error('old local archive leaked into the server day');
      const exportButton=[...panel.querySelectorAll('.room-chronicle-toolbar button')].find(b=>b.title.includes('导出当天纪事'));
      if(!exportButton||exportButton.disabled) throw Error('current server day export unavailable');
      exportButton.click();
      await pause(50);
      if(fixture.result.exportedDay?.entries[0]?.id!==entry.id) throw Error('export did not use the server day');
      const entries=n=>Array.from({length:n},(_,i)=>({...entry,id:'chronicle-'+i,at:entry.at-60000+i,text:'纪事 '+i}));
      const checkScroll=async(list,append)=>{
        await pause(120);
        if(list.scrollHeight<=list.clientHeight) throw Error('fixture did not overflow: '+list.className);
        list.scrollTop=0; append(); await pause(160);
        if(list.scrollHeight-list.scrollTop-list.clientHeight>2) throw Error('did not follow the latest entry: '+list.className);
      };
      fixture.setServerDay(day,entries(29));
      await checkScroll(panel.querySelector('.room-chronicle-entries'),()=>fixture.setServerDay(day,entries(30)));
      document.querySelectorAll('[role="tab"]')[0].click();
      fixture.setChatCount(45); await pause(220);
      await checkScroll(document.querySelector('.chat-message-list'),()=>fixture.setChatCount(46));
      document.querySelectorAll('[role="tab"]')[1].click();
      fixture.setServerDay(following, []);
      await pause(80);
      if(stories().length||!panel.textContent.includes('今天还没有纪事')) throw Error('midnight reused previous room entries');
      return true;
    })()`);
    await view.webContents.executeJavaScript("window.chronicleFixture.close()");
    console.log(JSON.stringify({ passed: true, checks, dailyHistory }));
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error(String(error.stack));
    clearTimeout(deadline);
    app.exit(1);
  }
});
