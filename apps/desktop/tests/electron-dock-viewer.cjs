/* global require, process, console, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "dock-viewer");
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 40000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ width: 1707, height: 960, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  view.webContents.setAudioMuted(true);
  view.webContents.on("console-message", (event) => console.log(event.message));
  try {
    const file = path.resolve("tests/fixtures/dock-viewer.html").replaceAll("\\", "/");
    await view.loadURL(`http://127.0.0.1:5174/@fs/${file}`);
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms)), check=(ok,why)=>{if(!ok)throw Error(why)};
      for(let i=0;i<100&&!document.querySelector('.voice-dock-presence button');i++)await wait(50);
      await document.fonts.ready;
      const controls=document.querySelector('.voice-dock-presence');
      check(controls,'dock status missing');
      check([...controls.querySelectorAll('button')].map(b=>b.textContent.trim()).join(',')==='离开,电话,吃饭,厕所','incorrect order');
      const button=controls.querySelector('button:last-child');
      const before=button.getBoundingClientRect(); button.click(); await wait(80); button.click(); await wait(80);
      const after=button.getBoundingClientRect(); check(Math.abs(before.x-after.x)<1&&Math.abs(before.y-after.y)<1,'status buttons shifted');
      const inlineVideo=document.querySelector('.screen-share-video');
      for(let i=0;i<40&&!inlineVideo.videoWidth;i++)await wait(50);
      check(inlineVideo.videoWidth===1280,'synthetic video has no presented frame');
      for(let i=0;i<30&&!document.documentElement.dataset.detachedStreamId;i++)await wait(50);
      const originalStreamId=document.documentElement.dataset.detachedStreamId;
      check(originalStreamId,'initial detached synchronization missing');
      const syncBefore=Number(document.documentElement.dataset.detachedSyncCount);
      document.dispatchEvent(new Event('fixture-replace-stream'));
      await wait(350);
      check(document.documentElement.dataset.detachedStreamId!==originalStreamId,'replacement stream never reached detached publisher');
      check(Number(document.documentElement.dataset.detachedSyncCount)===syncBefore+1,'replacement synchronization duplicated');
      const track=inlineVideo.srcObject.getVideoTracks()[0];
      for(let i=0;i<3;i++){
        document.querySelector('[aria-label="放大共享画面"]').click(); await wait(90);
        const modal=document.querySelector('dialog.screen-share-expanded-viewer');
        check(modal?.matches(':modal'),'expanded viewer missing top layer');
        const rect=modal.getBoundingClientRect(); check(rect.width>innerWidth*.9&&rect.height>innerHeight*.85,'viewer did not enlarge');
        check(modal.querySelector('video')?.srcObject===inlineVideo.srcObject,'shared stream changed');
        if(i===1) modal.dispatchEvent(new Event('cancel',{cancelable:true}));
        else modal.querySelector('[aria-label="返回房间"]').click();
        await wait(90); check(!document.querySelector('dialog.screen-share-expanded-viewer'),'viewer did not close');
        check(track.readyState==='live','closing viewer stopped share');
      }
      return { repeatedExpand:true, escapeReturn:true, liveTrack:true, statusToggleStable:true };
    })()`);
    console.log(JSON.stringify(result));
    await view.webContents.executeJavaScript(`document.querySelector('[aria-label="放大共享画面"]').click()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    await require("node:fs/promises").writeFile(path.resolve("../../artifacts/share-expanded-20261101.png"), (await view.webContents.capturePage()).toPNG());
    view.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    view.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    await new Promise(resolve => setTimeout(resolve, 100));
    if (await view.webContents.executeJavaScript(`Boolean(document.querySelector('dialog.screen-share-expanded-viewer'))`)) throw Error("real Escape did not return to room");
    console.log("native Escape returned to room");
    await require("node:fs/promises").writeFile(path.resolve("../../artifacts/dock-status-20261101.png"), (await view.webContents.capturePage()).toPNG());
    for (const width of [1707, 1280, 1024]) {
      view.setSize(width, 768);
      console.log(await view.webContents.executeJavaScript(`(async()=>{await new Promise(r=>setTimeout(r,100));const buttons=[...document.querySelectorAll('.voice-dock button')].filter(b=>b.getBoundingClientRect().width);for(const b of buttons){const r=b.getBoundingClientRect();if(r.left<0||r.right>innerWidth+1)throw Error('dock overflow at '+innerWidth)}const states=[...document.querySelectorAll('.voice-dock-presence button')].map(b=>b.getBoundingClientRect());if(states.some(r=>r.top!==states[0].top))throw Error('status controls wrapped');return 'dock fits '+innerWidth})()`));
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { view.destroy(); clearTimeout(deadline); app.exit(process.exitCode || 0); }
});
