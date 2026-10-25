/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "transcript-source-seek");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1080,
    webPreferences: { backgroundThrottling: false, offscreen: true },
  });
  try {
    const fixture = path
      .join(__dirname, "fixtures/recording-model-sync.html")
      .replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${fixture}`,
    );
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));const check=(value,message)=>{if(!value)throw Error(message)};
      for(let i=0;i<100&&!document.querySelector('.voice-memory-empty');i++)await pause(40);
      await pause(100);window.dispatchEvent(new Event('fixture-show-hybrid'));await pause(250);
      const selector=()=>document.querySelector('[aria-label="转录文字版本"]');
      check(selector(),'saved original selector missing');
      check(document.querySelector('.transcript-source-control').textContent.includes('云端原稿'),'pending fusion did not identify cloud fallback');
      check([...document.querySelectorAll('button')].some(b=>b.textContent.includes('融合校对')),'existing originals have no fusion action');
      check(!document.body.textContent.includes('尚未生成融合稿'),'redundant notice remains');
      selector().value='local';selector().dispatchEvent(new Event('change',{bubbles:true}));await pause(150);
      check(document.querySelector('.transcript-source-control').textContent.includes('本地原稿'),'display source follows settings instead of saved result');
      for(let i=0;i<100&&!document.querySelector('[data-transcript-start-ms="5000"]');i++)await pause(40);
      const last=document.querySelector('[data-transcript-start-ms="5000"]');check(last,'third sentence timing disappeared when paragraphs merged');
      last.click();await pause(60);check(document.documentElement.dataset.transcriptSeekMs==='5000','third sentence incorrectly seeks paragraph beginning');
      selector().value='cloud';selector().dispatchEvent(new Event('change',{bubbles:true}));await pause(150);
      check(document.body.textContent.includes('时间估算'),'cloud view claims forced alignment');
      check(!document.documentElement.dataset.lastProcessRequest,'changing the text view restarted transcription');
      selector().value='auto';selector().dispatchEvent(new Event('change',{bubbles:true}));
      window.dispatchEvent(new Event('fixture-show-fused'));await pause(200);
      check(document.querySelector('.transcript-source-control').textContent.includes('融合稿'),'automatic view did not switch to finished fusion');
      for(let i=0;i<100&&!document.querySelector('[data-transcript-start-ms="5000"]');i++)await pause(40);
      check(document.body.textContent.includes('校对后的第3句话'),'fused text missing: '+document.querySelector('.voice-memory-transcript')?.textContent);
      check([...selector().options].some(o=>o.value==='fusion'),'fused original selector missing');
      document.querySelector('[data-transcript-start-ms="5000"]').click();await pause(50);
      check(document.documentElement.dataset.transcriptSeekMs==='5000','fusion lost local acoustic timing');
      const panel=document.querySelector('.voice-memory-detail');
      check(!panel.textContent.includes('自动转录已开启'),'removed automatic-upload notice remains');
      const model=panel.querySelector('[aria-label="本地辅助模型"]');
      panel.querySelector('.recording-processing-settings').open=true;await pause(50);
      const css=getComputedStyle(model);const canvas=document.createElement('canvas');const ctx=canvas.getContext('2d');ctx.font=css.font;
      check(ctx.measureText(model.selectedOptions[0].textContent).width<=model.clientWidth-parseFloat(css.paddingLeft)-parseFloat(css.paddingRight)-24,'selected model label is clipped');
      const heights=[...panel.querySelectorAll('.voice-memory-header-actions > button')].map(b=>Math.round(b.getBoundingClientRect().height));
      check(new Set(heights).size===1,'action buttons have inconsistent heights');
      check(panel.scrollWidth<=panel.clientWidth+1,'recording panel overflows horizontally');
      check(![...panel.querySelectorAll('button')].some(b=>b.textContent.includes('整理内容')),'manual organize action remains');
      check(parseFloat(getComputedStyle(panel.querySelector('.transcript-paragraph > span')).fontSize)>=14,'transcript remains too small');
      panel.querySelector('.recording-processing-settings').open=false;
      return {threeSources:true,fusionAction:true,defaultFusion:true,thirdSentenceSeekMs:5000,switchDoesNotProcess:true};
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (process.env.SHANGHAO_TEST_SCREENSHOT)
      require("node:fs").writeFileSync(
        process.env.SHANGHAO_TEST_SCREENSHOT,
        (await view.webContents.capturePage()).toPNG(),
      );
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${fixture}?recovery=legacy_unverified`,
    );
    await view.webContents.executeJavaScript(`(async()=>{
      for(let i=0;i<100&&!document.querySelector('.voice-memory-empty');i++)await new Promise(r=>setTimeout(r,40));
      const empty=document.querySelector('.voice-memory-empty');
      if(!empty?.textContent.includes('找到旧稿，但录音身份无法确认，未自动套用'))throw Error('legacy recovery warning missing');
      if(empty.textContent.includes('还没有文字稿')||empty.querySelector('button')||document.querySelector('.transcript-paragraph'))throw Error('unverified legacy record exposes transcript or restart action');
    })()`);
    result.legacyRecoveryGuard = true;
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
