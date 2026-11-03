/* global require, __dirname, process, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "recording-range-clip");
app.disableHardwareAcceleration();
if (process.env.SHANGHAO_TEST_SCALE) app.commandLine.appendSwitch("force-device-scale-factor", process.env.SHANGHAO_TEST_SCALE);
const deadline = setTimeout(() => app.exit(1), 45000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1707, height: 960, webPreferences: { offscreen: true, backgroundThrottling: false } });
  try {
    const fixture = path.join(__dirname, "fixtures/recording-library-feedback.html").replaceAll("\\", "/");
    await win.loadURL(`http://127.0.0.1:5174/@fs/${fixture}`);
    await win.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      for(let i=0;i<150&&!document.querySelector('.recording-marker-clip-trigger');i++) await wait(40);
      const trigger = document.querySelector('.recording-marker-clip-trigger');
      if(!trigger) throw Error('clip trigger missing');
      trigger.click(); await wait(60);
      const start = document.querySelector('[aria-label="截取起点"]');
      const end = document.querySelector('[aria-label="截取终点"]');
      if(!start || !end || !document.querySelector('.recording-clip-selection')) throw Error('range handles missing');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(end, '40000'); end.dispatchEvent(new Event('input', {bubbles:true})); await wait(40);
      set.call(start, '10000'); start.dispatchEvent(new Event('input', {bubbles:true})); await wait(40);
      if(!document.querySelector('.recording-range-actions').textContent.includes('30.0 秒')) throw Error('range duration did not update');
      const audio = document.querySelector('audio'); let playing = false;
      Object.defineProperty(audio, 'paused', { configurable: true, get: () => !playing });
      audio.play = async () => { playing = true; };
      audio.pause = () => { playing = false; };
      [...document.querySelectorAll('.recording-range-actions button')].find(el=>el.textContent==='试听').click(); await wait(40);
      if (!playing || audio.currentTime !== 10) throw Error('preview did not begin at selected start');
      audio.currentTime = 40; audio.dispatchEvent(new Event('timeupdate')); await wait(40);
      if (playing) throw Error('preview did not stop at selected end');
      const originalExport = window.desktopApi.recording.exportClip; let exportCalls = 0;
      window.desktopApi.recording.exportClip = async (...args) => { exportCalls++; await wait(80); return originalExport(...args); };
      const exportButton = [...document.querySelectorAll('.recording-range-actions button')].find(el=>el.textContent==='导出片段');
      exportButton.click(); exportButton.click(); await wait(30);
      const dialog=document.querySelector('.recording-clip-consent[open]');
      if(dialog) { const confirm=[...dialog.querySelectorAll('button')].find(el=>el.textContent==='确认导出'); confirm.click(); confirm.click(); }
      await wait(130);
      if(exportCalls!==1) throw Error('duplicate clip export');
      const request=JSON.parse(document.documentElement.dataset.clipRequest || '{}');
      if(request.startMs!==10000 || request.endMs!==40000 || request.markerId) throw Error('incorrect clip export range');
      document.querySelectorAll('.recording-item-select')[1].click(); await wait(100);
      if(document.querySelector('.recording-range-actions')) throw Error('previous recording range carried over');
      if(!document.querySelector('.recording-marker-clip-trigger')) throw Error('unmarked recording cannot be trimmed');
      document.querySelector('.recording-marker-clip-trigger').click(); await wait(50);
    })()`);
    const drag = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('[aria-label="截取终点"]'), rect = el.getBoundingClientRect();
      return { x: rect.x + 8 + (rect.width - 16) * Number(el.value) / Number(el.max), y: rect.y + rect.height / 2, width: rect.width, max: Number(el.max), before: Number(el.value) };
    })()`);
    win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(drag.x), y: Math.round(drag.y) });
    win.webContents.sendInputEvent({ type: "mouseDown", x: Math.round(drag.x), y: Math.round(drag.y), button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(drag.x + (drag.width - 16) * 15000 / drag.max), y: Math.round(drag.y), button: "left" });
    win.webContents.sendInputEvent({ type: "mouseUp", x: Math.round(drag.x + (drag.width - 16) * 15000 / drag.max), y: Math.round(drag.y), button: "left", clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 100));
    const moved = await win.webContents.executeJavaScript(`Number(document.querySelector('[aria-label="截取终点"]').value)`);
    if (moved <= drag.before + 5000) throw Error(`end handle did not respond to mouse drag: ${drag.before} -> ${moved}`);
    const startDrag = await win.webContents.executeJavaScript(`(() => {
      const el = document.querySelector('[aria-label="截取起点"]'), rect = el.getBoundingClientRect();
      return { x: rect.x + 8 + (rect.width - 16) * Number(el.value) / Number(el.max), y: rect.y + rect.height / 2, width: rect.width, max: Number(el.max), before: Number(el.value) };
    })()`);
    win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(startDrag.x), y: Math.round(startDrag.y) });
    win.webContents.sendInputEvent({ type: "mouseDown", x: Math.round(startDrag.x), y: Math.round(startDrag.y), button: "left", clickCount: 1 });
    win.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(startDrag.x + (startDrag.width - 16) * 10000 / startDrag.max), y: Math.round(startDrag.y), button: "left" });
    win.webContents.sendInputEvent({ type: "mouseUp", x: Math.round(startDrag.x + (startDrag.width - 16) * 10000 / startDrag.max), y: Math.round(startDrag.y), button: "left", clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 100));
    const startMoved = await win.webContents.executeJavaScript(`Number(document.querySelector('[aria-label="截取起点"]').value)`);
    if (startMoved <= startDrag.before + 5000) throw Error(`start handle did not respond to mouse drag: ${startDrag.before} -> ${startMoved}`);
    process.stdout.write("recording range UI passed\n"); clearTimeout(deadline); app.exit(0);
  } catch(error) { process.stderr.write(String(error.stack || error)); clearTimeout(deadline); app.exit(1); }
});
