/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(
  app,
  "detached-remote-control-ui",
);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    width: 1000,
    height: 800,
    webPreferences: { backgroundThrottling: false, offscreen: true },
  });
  try {
    const file = path
      .join(__dirname, "fixtures/detached-remote-control-ui.html")
      .replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}?screenViewerSession=fixture-viewer`,
    );
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const wait=async(c,label)=>{for(let i=0;i<200;i++){if(c())return;await new Promise(r=>setTimeout(r,30));}throw Error(label)};
      const button=t=>[...document.querySelectorAll('button')].find(b=>b.textContent===t);
      await wait(()=>button('申请操作')&&!button('申请操作').disabled,'requestable decoded stream');
      if(window.desktopApi)throw Error('detached used main-window API');
      button('申请操作').click();await wait(()=>window.detachedEvidence.requests===1,'request');
      if(document.querySelector('.is-active'))throw Error('request self approved');
      window.allowDetached();await wait(()=>window.detachedEvidence.frames>0,'real local forwarded video decode');
      const overlay=()=>document.querySelector('.remote-control-viewer');const r=overlay().getBoundingClientRect();
      overlay().dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
      overlay().dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.x+1,clientY:r.y+1}));
      if(window.detachedEvidence.inputs.length!==1)throw Error('black-bar input');
      const p=window.detachedEvidence.inputs[0].event;if(Math.abs(p.x-.5)>.001||Math.abs(p.y-.5)>.001)throw Error('center mapping');
      window.pauseDetached();await wait(()=>!overlay().classList.contains('is-active'),'pause');
      window.resumeDetached();await wait(()=>overlay().classList.contains('is-active'),'resume');
      const input=document.querySelector('input[aria-label="发送文字到远程电脑"]');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'你好 🌍');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,50));input.closest('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
      await wait(()=>window.detachedEvidence.inputs.some(x=>x.event.kind==='text'&&x.event.text==='你好 🌍'),'unicode');
      window.dispatchEvent(new Event('blur'));await wait(()=>!overlay().classList.contains('is-active'),'focus cleanup');
      window.allowDetached();await wait(()=>overlay().classList.contains('is-active'),'second grant');
      window.fallbackDetached();await wait(()=>!overlay().classList.contains('is-active')&&button('申请操作').disabled,'fallback read only');
      return {detachedRequest:true,noSelfApproval:true,decodedFrames:window.detachedEvidence.frames,blackBarsIgnored:true,unicode:true,pauseResume:true,blurStops:true,fallbackReadOnly:true,nativeInputInjected:false};
    })()`);
    console.log(JSON.stringify(result));
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
