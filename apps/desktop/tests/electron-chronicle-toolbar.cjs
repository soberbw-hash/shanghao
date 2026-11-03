/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path"), fs = require("node:fs/promises");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "chronicle-toolbar");
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ show: false, width: 460, height: 740,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  view.webContents.setAudioMuted(true);
  try {
    await view.loadFile(path.resolve(__dirname, "../../../artifacts/native-ui/room-chronicle.static.html"));
    await view.webContents.executeJavaScript(`(async()=>{
      for(let i=0;i<100&&!window.chronicleFixture;i++)await new Promise(resolve=>setTimeout(resolve,30));
      document.querySelectorAll('[role="tab"]')[1].click();
    })()`);
    const dimensions = [];
    for (const width of [760, 460, 360]) {
      view.setSize(width, 740);
      dimensions.push(await view.webContents.executeJavaScript(`(async()=>{
        await document.fonts.ready;await new Promise(resolve=>setTimeout(resolve,100));
        const toolbar=document.querySelector('.room-chronicle-toolbar');
        const buttons=[...toolbar.querySelectorAll(':scope > button')];
        if(buttons.length!==2)throw Error('two toolbar actions expected');
        const sizes=buttons.map(button=>{const rect=button.getBoundingClientRect(),style=getComputedStyle(button),icon=button.querySelector('svg').getBoundingClientRect();
          return {width:rect.width,height:rect.height,font:style.fontSize,icon:icon.width};});
        if(sizes.some(size=>Math.abs(size.width-136)>.25||Math.abs(size.height-36)>.25||size.font!=='12px'||Math.abs(size.icon-14)>.25))throw Error('toolbar buttons differ: '+JSON.stringify(sizes));
        if(toolbar.scrollWidth>toolbar.clientWidth+1)throw Error('toolbar overflows');
        window.chronicleFixture.supported(false);await new Promise(resolve=>setTimeout(resolve,30));
        if(!buttons[1].disabled)throw Error('unavailable server still offers recording');
        return {viewport:${width},...sizes[0],unavailableDisabled:true};
      })()`));
    }
    await fs.writeFile(path.resolve(__dirname, "../../../artifacts/chronicle-toolbar-unified-20261101.png"), (await view.webContents.capturePage()).toPNG());
    await view.webContents.executeJavaScript("window.chronicleFixture.close()");
    console.log(JSON.stringify({ passed: true, dimensions }));
    clearTimeout(deadline); app.exit(0);
  } catch (error) { console.error(String(error)); clearTimeout(deadline); app.exit(1); }
});
