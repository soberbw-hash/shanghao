/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout, process */
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
    await view.loadFile(process.env.SHANGHAO_CHRONICLE_FIXTURE || path.resolve(__dirname, "../../../artifacts/native-ui/room-chronicle.static.html"));
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
        if(buttons.length!==3)throw Error('three toolbar actions expected');
        const sizes=buttons.map(button=>{const rect=button.getBoundingClientRect(),style=getComputedStyle(button),icon=button.querySelector('svg').getBoundingClientRect();
          return {width:rect.width,height:rect.height,font:style.fontSize,icon:icon.width};});
        if(sizes.some(size=>Math.abs(size.height-36)>.25||size.font!=='12px'||Math.abs(size.icon-14)>.25))throw Error('toolbar buttons differ: '+JSON.stringify(sizes));
        if(!buttons[0].textContent.includes('保存刚才对话')||!buttons[1].textContent.includes('导出聊天纪事'))throw Error('incorrect action order');
        if(toolbar.scrollWidth>toolbar.clientWidth+1)throw Error('toolbar overflows');
        window.chronicleFixture.supported(false);await new Promise(resolve=>setTimeout(resolve,30));
        if(!buttons[2].disabled)throw Error('unavailable server still offers recording');
        return {viewport:${width},...sizes[0],unavailableDisabled:true};
      })()`));
    }
    await fs.writeFile(path.resolve(__dirname, "../../../artifacts/chronicle-toolbar-unified-20261101.png"), (await view.webContents.capturePage()).toPNG());
    await view.webContents.executeJavaScript("window.chronicleFixture.close()");
    console.log(JSON.stringify({ passed: true, dimensions }));
    clearTimeout(deadline); app.exit(0);
  } catch (error) { console.error(String(error)); clearTimeout(deadline); app.exit(1); }
});
