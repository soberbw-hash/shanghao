/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "summary-retry");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    width: 1120,
    height: 1000,
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
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));const check=(value,message)=>{if(!value)throw Error(message)};
      for(let i=0;i<100&&!document.querySelector('.voice-memory-empty');i++)await pause(40);
      window.dispatchEvent(new Event('fixture-show-hybrid'));await pause(80);
      window.dispatchEvent(new Event('fixture-show-fused'));await pause(80);
      window.dispatchEvent(new Event('fixture-summary-failed'));await pause(120);
      const error=document.querySelector('.voice-memory-error');
      check(error?.textContent.includes('结果')&&error.textContent.includes('重试摘要'),'summary failure does not explain the actual retry action');
      check(!error.textContent.includes('custom_ai_invalid_json'),'provider error code leaked into user copy');
      check(document.querySelector('.transcript-source-control').textContent.includes('融合稿'),'summary error hid completed fusion');
      const retry=[...document.querySelectorAll('.recording-overview button')].find(button=>button.textContent.includes('重试摘要'));
      check(retry&&!retry.disabled,'summary failure has no usable retry');
      retry.click();await pause(100);
      const request=JSON.parse(document.documentElement.dataset.lastProcessRequest);
      check(request.manual===true&&request.organize===true&&request.transcribe===false&&request.restartTranscription===false&&request.fuse===false,'summary retry reran transcription or fusion');
      check(!Number(document.documentElement.dataset.publishCalls??0),'summary retry uploaded to the room');
      return {summaryFailureActionClear:true,completedFusionVisible:true,summaryOnlyRetry:true,noAutomaticPublication:true};
    })()`);
    if (view.isVisible()) throw Error("summary_retry_fixture_became_visible");
    console.log(JSON.stringify(result));
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
