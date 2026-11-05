/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "model-reference");
const timeout = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    const fixture = path
      .join(__dirname, "fixtures/recording-library-feedback.html")
      .replaceAll("\\", "/");
    await view.loadURL(`http://127.0.0.1:5173/@fs/${fixture}`);
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<100&&!document.querySelector('[title="模型对比"]');i++)await wait(50);
      const button=document.querySelector('[title="模型对比"]');
      if(!button)throw Error('model comparison entry missing');
      button.click();
      for(let i=0;i<100&&!document.querySelector('.model-comparison-reference');i++)await wait(50);
      const panel=document.querySelector('.model-comparison-reference');
      if(!panel)throw Error('reference controls missing');
      panel.querySelector('summary').click();
      const fileInput=panel.querySelector('input[type=file]');
      const files=new DataTransfer();files.items.add(new File(['大家集合'], 'reference.txt',{type:'text/plain'}));
      fileInput.files=files.files;fileInput.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(100);
      const reference=panel.querySelector('[aria-label="人工参考文本"]');
      if(reference.value!=='大家集合')throw Error('reference import failed');
      panel.querySelector('button').click();await wait(50);
      if(reference.value!=='')throw Error('reference clear failed');
      return {referenceImport:true,referenceClear:true};
    })()`);
    console.log(JSON.stringify(result));
    clearTimeout(timeout);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
