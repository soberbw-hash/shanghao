/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "text-selection");
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  view.webContents.on("console-message", (event) => {
    if (event.message.includes("Error")) console.error(event.message);
  });
  try {
    const fixture = path
      .join(__dirname, "fixtures/recording-model-sync.html")
      .replaceAll("\\", "/");
    await view.loadURL(`http://127.0.0.1:5173/@fs/${fixture}`);
    const coords = await view.webContents.executeJavaScript(`(async()=>{
      for(let i=0;i<100&&!document.querySelector('#ai-model-management');i++)await new Promise(r=>setTimeout(r,50));
      if(!document.querySelector('#ai-model-management'))throw Error('settings fixture did not mount');
      const host=document.createElement('div');host.style.cssText='position:fixed;top:5px;left:5px;z-index:99999;background:white';
      host.innerHTML='<span id="selection-label">这是界面上的普通文字</span><input id="selection-input" value="可以编辑和选择"><textarea id="selection-textarea">可以编辑和选择</textarea><div id="selection-editable" contenteditable="true"><span>可以编辑的内容</span></div>';
      document.body.append(host);
      const label=document.querySelector('#selection-label'), r=label.getBoundingClientRect(), input=document.querySelector('#selection-input').getBoundingClientRect();
      return {x1:Math.floor(r.left+2),x2:Math.floor(r.right-2),y:Math.floor(r.top+r.height/2), inputX1:Math.floor(input.left+5), inputX2:Math.floor(input.right-5), inputY:Math.floor(input.top+input.height/2)};
    })()`);
    await view.webContents.sendInputEvent({ type: "mouseMove", x: coords.x1, y: coords.y });
    await view.webContents.sendInputEvent({
      type: "mouseDown",
      x: coords.x1,
      y: coords.y,
      button: "left",
      clickCount: 1,
    });
    await view.webContents.sendInputEvent({
      type: "mouseMove",
      x: coords.x2,
      y: coords.y,
      button: "left",
    });
    await view.webContents.sendInputEvent({
      type: "mouseUp",
      x: coords.x2,
      y: coords.y,
      button: "left",
      clickCount: 1,
    });
    const result = await view.webContents.executeJavaScript(`(()=>{
      const label=document.querySelector('#selection-label');
      const selectedText=String(getSelection());
      if(getComputedStyle(label).userSelect!=='text'||!selectedText.includes('界面上的普通'))throw Error('ordinary UI text could not be selected by dragging: '+getComputedStyle(label).userSelect+'/'+JSON.stringify(selectedText));
      if(getComputedStyle(document.querySelector('#ai-model-management summary')).userSelect!=='text')throw Error('production settings label is not selectable');
      for(const selector of ['#selection-input','#selection-textarea','#selection-editable span'])if(getComputedStyle(document.querySelector(selector)).userSelect!=='text')throw Error('editable text selection disabled: '+selector);
      return {nativeDragSelectsText:true};
    })()`);
    await view.webContents.sendInputEvent({
      type: "mouseDown",
      x: coords.inputX1,
      y: coords.inputY,
      button: "left",
      clickCount: 1,
    });
    await view.webContents.sendInputEvent({
      type: "mouseMove",
      x: coords.inputX2,
      y: coords.inputY,
      button: "left",
    });
    await view.webContents.sendInputEvent({
      type: "mouseUp",
      x: coords.inputX2,
      y: coords.inputY,
      button: "left",
      clickCount: 1,
    });
    await view.webContents.executeJavaScript(
      `(()=>{const input=document.querySelector('#selection-input');if(input.selectionEnd<=input.selectionStart)throw Error('native input drag selection failed')})()`,
    );
    result.ordinaryTextSelection = true;
    result.editableSelection = true;
    console.log(JSON.stringify(result));
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
