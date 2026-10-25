/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "remote-control-ui");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 30_000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    width: 1000,
    height: 900,
    webPreferences: { backgroundThrottling: false, offscreen: true },
  });
  try {
    const file = path.join(__dirname, "fixtures/remote-control-ui.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}`,
    );
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const wait=async(c,label)=>{for(let i=0;i<150;i++){if(c())return;await new Promise(r=>setTimeout(r,30));}throw Error(label)};
      const button=(text)=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
      await wait(()=>window.remoteEvidence&&button('申请操作'),'fixture');
      window.incomingControl();await wait(()=>button('允许操作'),'incoming request');
      if(window.remoteEvidence.approved||window.remoteEvidence.nativeStarted)throw Error('request implicitly approved');
      button('允许操作').click();await wait(()=>button('暂停'),'approved');
      if(window.remoteEvidence.approved!==1)throw Error('approval repeat');
      button('暂停').click();await wait(()=>button('恢复操作'),'paused');
      button('恢复操作').click();await wait(()=>button('暂停'),'resumed');
      button('收回控制').click();await wait(()=>window.remoteEvidence.revoked===1&&!button('暂停'),'revoked');
      button('申请操作').click();await wait(()=>document.querySelector('.remote-control-viewer.is-active'),'remote approved');
      await wait(()=>window.remoteEvidence.frames>0,'actual decoded video callback');
      const overlay=document.querySelector('.remote-control-viewer');const r=overlay.getBoundingClientRect();
      overlay.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
      overlay.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+1}));
      await new Promise(r=>setTimeout(r,40));
      if(window.remoteEvidence.inputs.length!==1)throw Error('black bars generated input');
      const p=window.remoteEvidence.inputs[0];if(p.lane!=='pointer'||Math.abs(p.event.x-.5)>.001||Math.abs(p.event.y-.5)>.001)throw Error('wrong normalized point');
      button('结束操作').click();await wait(()=>!document.querySelector('.remote-control-viewer.is-active'),'ended');
      return {inertRequest:true,explicitApproval:true,pauseResume:true,revoke:true,decodedVideoFrames:window.remoteEvidence.frames,blackBarsIgnored:true,centerMapped:true,nativeInputInjected:false};
    })()`);
    if (process.env.SHANGHAO_TEST_SCREENSHOT)
      require("node:fs").writeFileSync(
        process.env.SHANGHAO_TEST_SCREENSHOT,
        (await view.webContents.capturePage()).toPNG(),
      );
    console.log(JSON.stringify(result));
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
