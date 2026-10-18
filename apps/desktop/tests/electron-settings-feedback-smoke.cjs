/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, process, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises"),
  os = require("node:os");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "settings-feedback");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 1450,
    height: 1000,
    webPreferences: { backgroundThrottling: false },
  });
  try {
    const file = path.join(__dirname, "visual/settings-feedback.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}`,
    );
    const result = await view.webContents.executeJavaScript(
      `(async()=>{
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const check=(ok,msg)=>{if(!ok)throw Error(msg)};
      for(let i=0;i<80&&!document.querySelector('[aria-label="文本整理与问答模型"]');i++)await pause(50);
      const select=document.querySelector('[aria-label="文本整理与问答模型"]');
      check(select,'settings did not mount');
      select.value='custom';select.dispatchEvent(new Event('change',{bubbles:true}));await pause(100);
      check(select.value==='custom','custom API selection snapped back to GLM');
      const forms=[...document.querySelectorAll('.ai-provider-fields')];
      check(forms.length===2,'provider forms are inconsistent');
      check(forms.every(el=>el.querySelectorAll('label').length===3),'missing provider field labels');
      check(document.querySelector('.recording-marker-cue').textContent.includes('时钟 09点47分'),'clock unit missing');
      window.dispatchEvent(new CustomEvent('shanghao:remote-audio-level',{detail:{peerId:'local-member',level:0.64}}));await pause(170);
      const meter=document.querySelector('.microphone-level-fill');
      check(meter.dataset.active==='true'&&meter.style.transform.includes('20'),'meter did not follow local level');
      document.querySelector('.microphone-meter-control').click();await pause(50);
      check(meter.dataset.active==='false'&&meter.style.transform.includes('100'),'muting did not clear meter');
      await pause(2600);
      check(!document.querySelector('.recording-marker-cue'),'marker cue did not expire while paused');
      return {passed:true,customApiSelectable:true,providerFormsUnified:true,localMeter:true,mutedMeterHidden:true,clockUnits:true,transientMarker:true};
    })()`,
      true,
    );
    await view.webContents.executeJavaScript(`(()=>{
      const text=document.querySelector('[aria-label="文本整理与问答模型"]');text.value='glm';text.dispatchEvent(new Event('change',{bubbles:true}));
      const asr=document.querySelector('[aria-label="语音转录模型来源"]');asr.value='cloud';asr.dispatchEvent(new Event('change',{bubbles:true}));
      document.querySelector('.ai-model-provider-grid').scrollIntoView({block:'center'});
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await fs.writeFile(
      path.join(os.tmpdir(), "shanghao-settings-feedback.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
    console.log(JSON.stringify(result));
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
