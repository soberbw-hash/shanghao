/* global require, process, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "recording-layout");
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 60_000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 1707,
    height: 960,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  view.webContents.on("console-message", (event) => {
    if (event.message.includes("Error")) process.stderr.write(event.message + "\n");
  });
  try {
    const file = path
      .resolve("tests/fixtures/recording-library-feedback.html")
      .replaceAll("\\", "/");
    await view.loadURL(`http://127.0.0.1:5174/@fs/${file}?layout`);
    const initial = await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<120&&!document.querySelector('.recording-marker-bar');i++)await wait(50);
      if(!document.querySelector('.recording-marker-bar'))throw Error('library did not mount');
      await wait(350);
      window.dispatchEvent(new CustomEvent('recording-fixture-state',{detail:'dense'}));
      await wait(100);
      const header=document.querySelector('.settings-page-header').getBoundingClientRect();
      const workspace=document.querySelector('.recording-library-workspace').getBoundingClientRect();
      if(workspace.top>header.bottom+12)throw Error('extra library header row remains');
      const chips=[...document.querySelectorAll('.recording-marker-times button')];
      if(chips.length!==4)throw Error('markers missing');
      chips[1].click();await wait(100);
      if(document.querySelector('audio').currentTime!==61)throw Error('marker did not seek');
      if(document.querySelector('.recording-marker-cue-slot')||document.querySelector('.voice-memory-timeline'))throw Error('duplicate marker cards remain');
      if(document.querySelector('.voice-memory-organization'))throw Error('processing details still occupy the transcript page');
      const overview=document.querySelector('.recording-overview > summary > span');
      if(overview && (getComputedStyle(overview).whiteSpace==='nowrap' || overview.scrollHeight>overview.clientHeight+1))throw Error('summary is truncated');
      const panel=document.querySelector('.recording-library-panel');panel.scrollTop=500;
      await wait(100);
      const bar=document.querySelector('.recording-marker-bar').getBoundingClientRect();
      if(bar.top<panel.getBoundingClientRect().top||bar.height>42)throw Error('marker row not sticky/compact');
      document.querySelector('.recording-marker-clip-trigger').click();await wait(100);
      const pop=document.querySelector('.recording-marker-popover');
      if(!pop.matches(':popover-open')||!pop.innerText.includes('00:01:01'))throw Error('clip editor missing chosen marker');
      [...pop.querySelectorAll('button')].find(b=>b.textContent.includes('试听')).click();await wait(100);
      if(document.querySelector('audio').currentTime!==41)throw Error('preview start incorrect');
      if(!pop.innerText.includes('00:01:01'))throw Error('preview changed chosen marker');
      [...pop.querySelectorAll('button')].find(b=>b.textContent.trim()==='导出').click();await wait(80);
      if(!document.querySelector('dialog[open]'))throw Error('export consent missing');
      return {headerBottom:header.bottom,workspaceTop:workspace.top,markerHeight:bar.height};
    })().catch(error=>{console.error(error.stack);throw error})`);
    await view.webContents.sendInputEvent({ type: "keyDown", keyCode: "ESCAPE" });
    await view.webContents.sendInputEvent({ type: "keyUp", keyCode: "ESCAPE" });
    await new Promise((r) => setTimeout(r, 80));
    await view.webContents.executeJavaScript(`(()=>{
      if(document.querySelector('dialog[open]'))throw Error('consent Escape failed');
    })()`);
    await view.webContents.sendInputEvent({ type: "keyDown", keyCode: "ESCAPE" });
    await view.webContents.sendInputEvent({ type: "keyUp", keyCode: "ESCAPE" });
    await new Promise((r) => setTimeout(r, 80));
    await view.webContents.executeJavaScript(`(()=>{
      if(document.querySelector('.recording-marker-popover').matches(':popover-open'))throw Error('popover Escape failed');
      document.querySelector('.recording-library-panel').scrollTop=0;
    })()`);
    await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      document.querySelector('.recording-marker-clip-trigger').click();await wait(80);
      const pop=document.querySelector('.recording-marker-popover');
      [...pop.querySelectorAll('button')].find(b=>b.textContent.trim()==='导出').click();await wait(80);
      [...document.querySelector('dialog[open]').querySelectorAll('button')].find(b=>b.textContent.includes('确认导出')).click();await wait(120);
      const request=JSON.parse(document.documentElement.dataset.clipRequest||'{}');
      if(request.markerId!=='game'||request.beforeMs!==20000||request.afterMs!==8000)throw Error('wrong clip export request');
      if(!pop.innerText.includes('演示片段.m4a'))throw Error('clip export result missing '+JSON.stringify({open:pop.matches(':popover-open'),text:pop.textContent}));
    })()`);
    await fs.writeFile(
      path.resolve("../../artifacts/recording-marker-editor-20261031.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
    await view.webContents.sendInputEvent({
      type: "mouseDown",
      x: 35,
      y: 30,
      button: "left",
      clickCount: 1,
    });
    await view.webContents.sendInputEvent({
      type: "mouseUp",
      x: 35,
      y: 30,
      button: "left",
      clickCount: 1,
    });
    await new Promise((r) => setTimeout(r, 80));
    await view.webContents.executeJavaScript(`(()=>{
      if(document.querySelector('.recording-marker-popover').matches(':popover-open'))throw Error('outside click did not dismiss');
    })()`);
    const layouts = [];
    for (const [width, height] of [
      [1707, 960],
      [1280, 720],
      [1024, 768],
    ]) {
      view.setSize(width, height);
      await new Promise((r) => setTimeout(r, 200));
      layouts.push(
        await view.webContents.executeJavaScript(`(()=>{
        const panel=document.querySelector('.recording-library-panel'),bar=document.querySelector('.recording-marker-bar');
        const rect=panel.getBoundingClientRect(), header=document.querySelector('.settings-page-header');
        const toolbar=header.querySelector('.recording-library-toolbar').getBoundingClientRect();
        const back=header.querySelector('.settings-back-button').getBoundingClientRect();
        if(toolbar.right>back.left||rect.bottom>innerHeight+1||rect.height<450||bar.scrollWidth>bar.clientWidth+1)throw Error('layout overlap/overflow '+JSON.stringify({width:innerWidth,height:innerHeight,toolbarRight:toolbar.right,backLeft:back.left,panelBottom:rect.bottom,panelHeight:rect.height,barWidth:bar.clientWidth,barScroll:bar.scrollWidth}));
        if(document.documentElement.scrollWidth>innerWidth)throw Error('page horizontal overflow');
        const controls=document.querySelector('.voice-memory-detail header').getBoundingClientRect();
        if(controls.top-bar.getBoundingClientRect().bottom>22)throw Error('player-toolbar empty gap');
        return {width:innerWidth,height:innerHeight,panelHeight:Math.round(rect.height)};
      })()`),
      );
      await fs.writeFile(
        path.resolve(`../../artifacts/recording-layout-${width}-20261031.png`),
        (await view.webContents.capturePage()).toPNG(),
      );
    }
    await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      document.querySelectorAll('.recording-item-select')[1].click();await wait(200);
      if(document.querySelector('.recording-marker-bar'))throw Error('old markers carried to unmarked recording');
      document.querySelectorAll('.recording-item-select')[0].click();await wait(200);
      if(document.querySelectorAll('.recording-marker-times button').length!==4||document.querySelector('.recording-clips-panel'))throw Error('marker state not reset on recording switch');
    })()`);
    process.stdout.write(
      JSON.stringify({
        ok: true,
        ...initial,
        layouts,
        seek: true,
        sticky: true,
        preview: true,
        consentEscape: true,
        popoverEscape: true,
        clipExportRequest: true,
        outsideDismiss: true,
        recordingSwitch: true,
      }) + "\n",
    );
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    process.stderr.write(String(error) + "\n");
    clearTimeout(deadline);
    app.exit(1);
  }
});
