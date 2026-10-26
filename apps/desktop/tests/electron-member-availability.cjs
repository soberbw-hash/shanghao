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
        if(buttons.length!==5)throw Error('phone and return buttons must occupy stable slots');
        window.availabilityGeometry=buttons.map(b=>{const r=b.getBoundingClientRect();return [r.x,r.y,r.width,r.height]});
        if(!buttons[4].disabled)throw Error('return should be disabled while already available');
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
          if(root.dataset.status!=='restroom')throw Error('stationary repeat click activated a different action');
          if(document.documentElement.dataset.muted!=='true')throw Error('restroom did not keep microphone muted');
          [...root.querySelectorAll('button')].forEach((b,i)=>{const r=b.getBoundingClientRect();[r.x,r.y,r.width,r.height].forEach((n,k)=>{if(Math.abs(n-window.availabilityGeometry[i][k])>0.5)throw Error('availability button moved after status change')})});
        })()`);
      }
      await view.webContents.executeJavaScript(`(async()=>{
        const buttons=[...document.querySelectorAll('.member-availability-controls button')];
        for(const index of [0,2,3,4]){buttons[index].click();await new Promise(r=>setTimeout(r,30));buttons.forEach((b,i)=>{const r=b.getBoundingClientRect();[r.x,r.y,r.width,r.height].forEach((n,k)=>{if(Math.abs(n-window.availabilityGeometry[i][k])>0.5)throw Error('switching or returning moved a button')})});}
        if(document.documentElement.dataset.muted!=='false')throw Error('return did not restore microphone choice');
      })()`);
    }
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
