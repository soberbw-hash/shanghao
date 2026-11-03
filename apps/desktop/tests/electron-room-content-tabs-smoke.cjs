/* global require, process, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports -- Electron test entry runs as CommonJS. */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "room-content-tabs");
app.disableHardwareAcceleration();
const timeout = setTimeout(() => app.exit(1), 35_000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 650,
    height: 900,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  try {
    const file = path.resolve("tests/visual/room-content-tabs.html").replaceAll("\\", "/");
    await view.loadURL(`http://127.0.0.1:5174/@fs/${file}`);
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms)), check=(ok,why)=>{if(!ok)throw Error(why)};
      for(let i=0;i<100&&!window.tabFixture;i++)await wait(50);
      await wait(500);
      const tabs=()=>[...document.querySelectorAll('[role="tab"]')];
      const panels=()=>[...document.querySelectorAll('[role="tabpanel"]')];
      const dot=i=>!!tabs()[i].querySelector('.chat-content-unread');
      check(tabs().length===2&&panels().length===2,'production tabs/panels missing');
      check(!dot(0)&&!dot(1),'history produced unread dot');
      const quick=document.querySelector('.chat-quick-actions'), list=document.querySelector('.chat-message-list');
      list.scrollTop=70; list.dispatchEvent(new Event('scroll'));
      const scroll=list.scrollTop;
      const input=document.querySelector('input,textarea');
      const setter=Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;
      setter.call(input,'保留草稿');input.dispatchEvent(new Event('input',{bubbles:true}));
      window.tabFixture.chronicle();await wait(80);check(dot(1),'start did not notify inactive transcript');
      tabs()[1].click();await wait(65);
      check(Number(getComputedStyle(panels()[1]).opacity)>0&&Number(getComputedStyle(panels()[1]).opacity)<1,'forward transition not animated');
      check(panels()[0].inert&&!panels()[1].inert,'hidden page accepts interaction');
      await wait(350);check(!dot(1),'click did not clear transcript dot');
      check(!document.body.innerText.includes('把刚才的梗留下来')&&!document.body.innerText.includes('当前服务器尚未启用纪事'),'removed copy remains');
      tabs()[0].click();await wait(65);
      check(Number(getComputedStyle(panels()[0]).opacity)>0&&Number(getComputedStyle(panels()[0]).opacity)<1,'reverse transition not animated');
      await wait(350);check(list===document.querySelector('.chat-message-list')&&list.scrollTop===scroll,'scroll DOM/position lost');
      check(input.value==='保留草稿','draft lost');check(quick===document.querySelector('.chat-quick-actions'),'quick actions remounted');
      window.tabFixture.chronicle(true);await wait(80);check(dot(1),'new transcript entry did not notify');
      tabs()[1].click();await wait(300);check(!dot(1),'transcript entry dot not cleared');
      window.tabFixture.message('fresh');await wait(100);check(dot(0),'incoming chat did not notify');
      tabs()[0].click();await wait(300);check(!dot(0),'chat dot not cleared');
      window.tabFixture.repeat();await wait(100);check(!dot(0)&&!dot(1),'reconnect duplicate alerted again');
      tabs()[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await wait(300);
      check(tabs()[1].getAttribute('aria-selected')==='true'&&document.activeElement===tabs()[1],'keyboard tab navigation failed');
      return {ok:true,bothDirections:true,unread:true,scrollAndDraftPreserved:true,quickActionsStable:true,keyboard:true};
    })()`);
    await fs.writeFile(
      path.resolve("../../artifacts/chat-transcript-tabs-20261031.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
    view.setSize(440, 780);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await view.webContents.executeJavaScript(`(()=>{
      const tabs=document.querySelector('.chat-content-tabs').getBoundingClientRect();
      const actions=document.querySelector('.chat-title-actions').getBoundingClientRect();
      const presence=[...document.querySelectorAll('.member-availability-controls button')].map(b=>b.getBoundingClientRect());
      if(tabs.right>actions.left||presence.some(r=>r.left<tabs.right||r.right>actions.left))throw Error('compact header overlap');
    })()`);
    await fs.writeFile(
      path.resolve("../../artifacts/chat-transcript-tabs-compact-20261031.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
    await view.loadURL(`http://127.0.0.1:5174/@fs/${file}?reduced`);
    await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<100&&!document.querySelector('[role="tab"]');i++)await wait(50);
      const tabs=[...document.querySelectorAll('[role="tab"]')];
      for(const index of [1,0,1,0]){tabs[index].click();await wait(25);}
      await wait(200);
      const pages=[...document.querySelectorAll('[role="tabpanel"]')];
      if(pages[0].inert||!pages[1].inert||Number(getComputedStyle(pages[0]).opacity)!==1||getComputedStyle(pages[0]).transform!=='none')throw Error('reduced/rapid switching failed');
    })()`);
    Object.assign(result, { compactHeader: true, reducedAndRapidSwitching: true });
    process.stdout.write(JSON.stringify(result) + "\n");
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    process.stderr.write(String(error) + "\n");
    clearTimeout(timeout);
    app.exit(1);
  }
});
