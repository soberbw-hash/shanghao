/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "recording-model-sync");
const timeout = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 1440,
    height: 1000,
    show: false,
    webPreferences: { backgroundThrottling: false, offscreen: true },
  });
  view.webContents.on("console-message", (event) => {
    if (event.level === "error") console.error(event.message);
  });
  try {
    const fixture = path
      .join(__dirname, "fixtures/recording-model-sync.html")
      .replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${fixture}`,
    );
    await view.webContents.executeJavaScript(`(async()=>{
      for(let i=0;i<100&&!document.querySelector('#ai-model-management');i++)await new Promise(r=>setTimeout(r,40));
      const advanced=document.querySelector('#ai-model-management');
      if(!advanced||advanced.open)throw Error('advanced model configuration should start collapsed');
      if(!document.querySelector('[aria-label="自动整理"]').checkVisibility())throw Error('automatic controls hidden with advanced settings');
      if(advanced.textContent.includes('按需更改 API、下载或管理本地模型')||advanced.querySelector('#model-management-title'))throw Error('redundant model heading remains');
      const processing=document.querySelector('.recording-processing-settings');
      if(!processing||processing.open)throw Error('recording processing settings should start collapsed');
      if(document.querySelector('[aria-label="录音库转录模型"]').checkVisibility())throw Error('collapsed recording processing settings expose model controls');
      processing.querySelector('summary').click();
      if(!processing.open||!document.querySelector('[aria-label="录音库转录模型"]').checkVisibility())throw Error('recording processing settings cannot be expanded');
      processing.querySelector('select').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      if(!processing.open)throw Error('inside click closed recording processing settings');
      document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
      if(processing.open)throw Error('outside click did not close recording processing settings');
      processing.querySelector('summary').click();
      processing.querySelector('summary').focus();
      processing.querySelector('summary').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      if(processing.open||document.activeElement!==processing.querySelector('summary'))throw Error('Escape did not close settings and restore focus');
      processing.querySelector('summary').click();
      if(advanced.querySelector('summary')?.tagName!=='SUMMARY')throw Error('advanced disclosure lost its native summary semantics');
      advanced.querySelector('summary').click();
    })()`);
    await view.webContents.sendInputEvent({
      type: "mouseDown",
      x: 8,
      y: 8,
      button: "left",
      clickCount: 1,
    });
    await view.webContents.sendInputEvent({
      type: "mouseUp",
      x: 8,
      y: 8,
      button: "left",
      clickCount: 1,
    });
    await view.webContents.executeJavaScript(`(()=>{
      const processing=document.querySelector('.recording-processing-settings');
      if(processing.open)throw Error('native outside click did not close recording settings');
      processing.querySelector('summary').click();
    })()`);
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms)); const check=(v,m)=>{if(!v)throw Error(m)};
      for(let i=0;i<100&&!document.querySelector('#ai-model-management')?.open;i++)await pause(40);
      const library=()=>document.querySelector('[aria-label="录音库转录模型"]');
      const settings=()=>document.querySelector('[aria-label="语音转录模型来源"]');
      check(library(),'recording library model selector missing');
      check([...library().options].map(o=>o.value).join('|')==='cloud|hybrid|custom','unexpected recording provider options');
      check(document.querySelector('#ai-model-management').open,'click did not expand model configuration');
      check(library().value==='hybrid','library did not inherit cloud default');
      await pause(150);
      const textModel=()=>document.querySelector('select[aria-label="文本整理与问答模型"]');
      const activeText=()=>document.querySelectorAll('.ai-overview-grid strong')[1].textContent;
      const saveText=()=>document.querySelector('[aria-label="保存文本模型配置"]');
      textModel().value='cloud';textModel().dispatchEvent(new Event('change',{bubbles:true}));await pause(100);
      check(activeText()==='glm-4-flash-250414','text model selection applied before Save');
      const advanced=document.querySelector('#ai-model-management');
      advanced.querySelector('summary').click();await pause(40);
      check(!advanced.open,'advanced disclosure cannot collapse');
      check(document.querySelector('[aria-label="自动整理"]').checkVisibility(),'collapsing advanced settings hid automatic controls');
      advanced.querySelector('summary').click();await pause(40);
      check(advanced.open&&textModel().value==='cloud','collapsing advanced settings discarded the unsaved text draft');
      check(activeText()==='glm-4-flash-250414','collapsing advanced settings committed the unsaved draft');
      check(saveText(),'room cloud has no explicit Save action');
      window.dispatchEvent(new Event('fixture-fail-settings-save'));saveText().click();await pause(100);
      check(activeText()==='glm-4-flash-250414','failed save replaced the active model');
      check(!saveText().disabled,'failed model save cannot be retried');
      saveText().click();await pause(100);check(activeText()==='内置云端模型','saved cloud model did not activate');
      textModel().value='custom';textModel().dispatchEvent(new Event('change',{bubbles:true}));await pause(100);
      check(activeText()==='内置云端模型','custom selection applied before Save');
      saveText().click();await pause(100);check(activeText()==='glm-4-flash-250414','saved GLM did not activate');
      const choose=async(select,value)=>{select.value=value;select.dispatchEvent(new Event('change',{bubbles:true}));await pause(100)};
      const assist=()=>[library(),settings()];
      const assistModels=()=>[...document.querySelectorAll('select[aria-label="本地辅助模型"]')];
      check(!document.querySelector('.transcription-data-notice'),'obsolete upload notice is visible');
      window.dispatchEvent(new CustomEvent('fixture-model-usage',{detail:true}));await pause(100);
      check(textModel().matches(':disabled')&&settings().matches(':disabled'),'AI model selectors remain usable during a global task');
      check(library().disabled,'library selector remains usable while another task runs');
      check([...document.querySelectorAll('.ai-model-provider-panel input,.ai-model-provider-panel button')].every(e=>e.matches(':disabled')),'API configuration can change during model use');
      check(assist().every(e=>e.matches(":disabled")),'hybrid option can change during a global task');
      check(assistModels().every(e=>e.disabled),'local assist model can change during a global task');
      window.dispatchEvent(new CustomEvent('fixture-model-usage',{detail:false}));await pause(100);
      check(!textModel().matches(':disabled')&&!settings().matches(':disabled')&&!library().disabled,'model configuration did not unlock after task cleanup');
      check(assist().length===2,'hybrid control missing from one settings page');
      check(assist().every(b=>b.value==='hybrid'),'hybrid should default enabled');
      check(assistModels().length===2&&assistModels().every(e=>e.value==='qwen3-asr-0.6b-force'),'assist default is not Qwen 0.6B');
      assistModels()[0].value='qwen3-asr-1.7b-force';assistModels()[0].dispatchEvent(new Event('change',{bubbles:true}));await pause(100);
      check(assistModels().every(e=>e.value==='qwen3-asr-1.7b-force'),'stronger assist model did not sync');
      check(library().value==='hybrid','assist model selection changed the cloud provider');
      check([...document.querySelectorAll('.cloud-local-assist-fallback')].length===2,'missing model fallback is absent from a processing entry');
      check([...document.querySelectorAll('.cloud-local-assist-fallback')].every(e=>e.textContent.includes('先用云端')),'missing model must retain cloud-only processing');
      document.querySelector('[aria-label="下载辅助模型"]').click();await pause(100);
      check(document.documentElement.dataset.downloadModel==='qwen3-asr-1.7b-force','download did not target the chosen assistance model');
      assistModels()[1].value='qwen3-asr-0.6b-force';assistModels()[1].dispatchEvent(new Event('change',{bubbles:true}));await pause(100);
      check(assistModels().every(e=>e.value==='qwen3-asr-0.6b-force'),'assist model did not sync back');
      await choose(library(),'cloud');check(settings().value==='cloud'&&assistModels().length===0,'cloud-only did not sync');
      await choose(settings(),'hybrid');check(library().value==='hybrid','hybrid did not sync');
      await choose(settings(),'custom');check(library().value==='custom','custom did not sync');
      check(!document.querySelector('[aria-label="筛选模型"]'),'obsolete model filter returned');
      document.querySelector('[data-model-id="paraformer-zh"] .ai-model-select-hit').click();await pause(100);
      check(settings().value==='local'&&library().value==='local','offline model card did not select offline mode');
      await choose(library(),'cloud');
      const gameContext=document.querySelector('[aria-label="游戏词汇自动适配"]');
      check(!gameContext,'automatic game context should stay out of the recording transcript');
      [...document.querySelectorAll('.voice-memory-header-actions button')].find(b=>b.textContent.includes('开始转录')).click();await pause(120);
      const manualRequest=JSON.parse(document.documentElement.dataset.lastProcessRequest);
      check(manualRequest.manual===true&&manualRequest.transcribe===true&&manualRequest.organize===false&&manualRequest.restartTranscription===true,'manual transcription must respect the organization preference');
      check(manualRequest.localAsrAutoGameContext===true&&!manualRequest.localAsrContext,'automatic game context should be requested without fabricating a manual override');
      check(document.querySelector('.voice-memory-working'),'queued acknowledgement hid newer processing event');
      check(document.querySelector('.voice-memory-working').textContent.includes('第 1/3 段'),'cloud stage detail missing');
      const pauseButton=[...document.querySelectorAll('.voice-memory-detail button')].find(b=>b.textContent.includes('暂停'));
      check(pauseButton,'pending provider cannot be paused');check(library().disabled,'model can change during active transcription');
      pauseButton.click();await pause(100);check(!library().disabled,'paused task cannot switch model');
      window.dispatchEvent(new Event('fixture-recording-ready'));await pause(100);
      document.querySelector('.recording-processing-settings summary').click();await pause(50);
      await choose(library(),'hybrid');
      check(assist().every(b=>b.value==='hybrid'),'cloud assistance did not stay synchronized after transcription');
      const retry=[...document.querySelectorAll('.voice-memory-header-actions button')].find(b=>b.textContent.includes('重新转录'));
      check(retry,'existing cloud recording cannot be reprocessed with current settings');
      retry.click();await pause(100);
      const retryRequest=JSON.parse(document.documentElement.dataset.lastProcessRequest);
      check(retryRequest.manual===true&&retryRequest.transcribe===true&&retryRequest.organize===false&&retryRequest.restartTranscription===true,'cloud retranscription must respect the organization preference');
      window.dispatchEvent(new Event('fixture-show-hybrid'));await pause(150);
      window.dispatchEvent(new Event('fixture-show-unexamined'));await pause(100);
      const detail=document.querySelector('.voice-memory-detail');
      check(detail?.querySelector('.recording-processing-settings'),'transcription controls are missing');
      check(!/查看待复核区间|查看未检查区间/.test(detail.textContent),'diagnostic ranges leaked into the reading view');
      window.dispatchEvent(new Event('fixture-clear-unexamined'));await pause(100);
      const fuse=[...document.querySelectorAll('.voice-memory-header-actions button')].find(b=>b.textContent.includes('融合校对'));
      check(fuse,'saved cloud and local originals have no fusion action');
      fuse.click();await pause(100);
      const fusionRequest=JSON.parse(document.documentElement.dataset.lastProcessRequest);
      check(fusionRequest.manual===true&&fusionRequest.transcribe===false&&fusionRequest.organize===true&&fusionRequest.fuse===true&&fusionRequest.restartTranscription===false,'fusion must preserve originals and automatically organize without retranscription');
      window.dispatchEvent(new Event('fixture-show-summary'));await pause(100);
      const overview=document.querySelector('[aria-label="录音概览"]');
      check(overview?.textContent.includes('合成录音的简短概述。'),'completed overview lost its short description');
      check(overview.querySelectorAll('li').length===3,'overview must stay concise with three summary points');
      check(!overview.textContent.includes('摘要要点4'),'overview leaked additional summary points');
      [...overview.querySelectorAll('li button')][2].click();await pause(30);
      check(document.documentElement.dataset.transcriptSeekMs==='5000','summary point lost its original audio offset');
      check(!Number(document.documentElement.dataset.publishCalls??0),'transcription or completed summary uploaded without an explicit action');
      return {hiddenWindow:true,recordingSettingsDisclosure:true,advancedDisclosureClick:true,nativeSummarySemantics:true,collapsedDraftPreserved:true,textModelSaveRequired:true,failedSaveRetainsActiveModel:true,dataDestinationSynced:true,defaultInherited:true,bidirectional:true,hybridBidirectional:true,organizationPreferenceRespected:true,existingCloudReprocesses:true,fusionOrganizes:true,conciseOverview:true,summarySeek:true,noAutomaticPublication:true,localCardSwitch:true,lateAcknowledgementIgnored:true,cloudStageVisible:true,pauseAvailable:true};
    })()`);
    if (process.env.SHANGHAO_TEST_SCREENSHOT) {
      await view.webContents.executeJavaScript(
        `document.querySelector('.ai-model-provider-grid').scrollIntoView({block:'center'})`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      require("node:fs").writeFileSync(
        process.env.SHANGHAO_TEST_SCREENSHOT,
        (await view.webContents.capturePage()).toPNG(),
      );
    }
    if (view.isVisible()) throw new Error("recording model fixture became visible");
    console.log(JSON.stringify(result));
    clearTimeout(timeout);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
