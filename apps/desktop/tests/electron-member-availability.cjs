/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "member-availability");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 760,
    height: 500,
    show: false,
    webPreferences: { backgroundThrottling: false, offscreen: true },
  });
  try {
    const fixture = path.join(__dirname, "fixtures/member-availability.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${fixture}`,
    );
    for (const width of [760, 420]) {
      view.setSize(width, 500);
      await view.webContents.executeJavaScript(`(async()=>{
        await document.fonts.ready;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        for(let i=0;i<100&&!document.querySelector('.member-availability-controls');i++)await new Promise(r=>setTimeout(r,30));
        const root=document.querySelector('.member-availability-controls');
        const buttons=[...root.querySelectorAll('button')];
        if(buttons.length!==4)throw Error('four state buttons expected');
        window.availabilityGeometry=buttons.map(b=>{const r=b.getBoundingClientRect();return [r.x,r.y,r.width,r.height]});
      })()`);
      const point = await view.webContents.executeJavaScript(
        `(()=>{const r=document.querySelector('.member-availability-controls button:nth-child(4)').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
      );
      for (let click = 0; click < 2; click++) {
        await view.webContents.executeJavaScript(
          `document.elementFromPoint(${point.x}, ${point.y})?.closest('button')?.click()`,
        );
        await view.webContents.executeJavaScript(`(async()=>{
          await new Promise(r=>setTimeout(r,70));
          const root=document.querySelector('.member-availability-controls');
          const expected=${click}===0?'restroom':'available';
          if(root.dataset.status!==expected)throw Error('repeat click did not toggle restroom');
          if(document.documentElement.dataset.muted!==String(${click}===0))throw Error('restroom microphone state incorrect');
          if(document.documentElement.dataset.deafened!=='false')throw Error('restroom unexpectedly disabled speaker');
          [...root.querySelectorAll('button')].forEach((b,i)=>{const r=b.getBoundingClientRect();[r.x,r.y,r.width,r.height].forEach((n,k)=>{if(Math.abs(n-window.availabilityGeometry[i][k])>0.5)throw Error('availability button moved after status change')})});
        })()`);
      }
      await view.webContents.executeJavaScript(`(async()=>{
        const buttons=[...document.querySelectorAll('.member-availability-controls button')];
        for(const index of [0,2,3,3]){buttons[index].click();await new Promise(r=>setTimeout(r,60));if(index===0&&document.documentElement.dataset.deafened!=='true')throw Error('away did not disable speaker');if(index===2&&document.documentElement.dataset.deafened!=='false')throw Error('eating should restore speaker');buttons.forEach((b,i)=>{const r=b.getBoundingClientRect();[r.x,r.y,r.width,r.height].forEach((n,k)=>{if(Math.abs(n-window.availabilityGeometry[i][k])>0.5)throw Error('switching or returning moved a button')})});}
        if(document.documentElement.dataset.muted!=='false')throw Error('return did not restore microphone choice');
      })()`);
    }
    await view.webContents.executeJavaScript(`(async()=>{
      const buttons=[...document.querySelectorAll('.member-availability-controls button')];
      document.dispatchEvent(new Event('fixture-manual-mute'));
      buttons[0].click();await new Promise(r=>setTimeout(r,80));
      buttons[0].click();await new Promise(r=>setTimeout(r,80));
      if(document.documentElement.dataset.manualMute!=='true'||document.documentElement.dataset.muted!=='true')throw Error('manual mute was not restored');
    })()`);
    console.log(
      JSON.stringify({
        stableGeometry: true,
        stationaryRepeatClick: true,
        narrowLayout: true,
        microphoneRestore: true,
      }),
    );
    clearTimeout(timeout);
    view.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    view.destroy();
    app.exit(1);
  }
});
