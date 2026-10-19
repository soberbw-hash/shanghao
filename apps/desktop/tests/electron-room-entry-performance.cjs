/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, process, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "room-entry-performance");
if (process.argv.includes("--reduce-motion"))
  app.commandLine.appendSwitch("force-prefers-reduced-motion");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 1000,
    height: 900,
    webPreferences: { backgroundThrottling: false },
  });
  try {
    const file = path.join(__dirname, "fixtures/room-entry-performance.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5194"}/@fs/${file}`,
    );
    const result = await view.webContents.executeJavaScript(
      `(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let i=0;i<100&&!window.performanceFixture;i++) await pause(40);
      await window.performanceFixture.unlockUiSounds();
      await pause(1000);
      const fixture = window.performanceFixture;
      const sources = [];
      const nativeStart = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        sources.push({ duration: this.buffer?.duration, startedAt: performance.now() });
        return nativeStart.apply(this,args);
      };
      const sounds = [];
      for (const cue of ['button-click','enter-room','member-join','record-start']) {
        const started = performance.now(); window.performanceFixture.playUiSound(cue);
        sounds.push({cue, synchronousMs: performance.now()-started}); await pause(100);
      }
      const states = [], longTasks = [], frames = [];
      const root = document.querySelector('.digit-code-input');
      const observer = new MutationObserver(() => {
        const state = root.dataset.state;
        if (states.at(-1) !== state) states.push(state);
      });
      observer.observe(root,{attributes:true,attributeFilter:['data-state']});
      const longObserver = new PerformanceObserver(list => longTasks.push(...list.getEntries().map(e=>e.duration)));
      longObserver.observe({type:'longtask'});
      let running=true,last=performance.now();
      const tick=now=>{frames.push(now-last);last=now;if(running)requestAnimationFrame(tick)};
      requestAnimationFrame(tick);
      document.querySelector('[aria-label="随机可用频道号"]').click();
      await pause(30);
      const originalFocus = document.hasFocus;
      document.hasFocus = () => false; window.dispatchEvent(new Event('blur'));
      const pose = root.querySelector('.digit-code-cell').style.transform;
      await pause(220);
      const hiddenPaused = pose === root.querySelector('.digit-code-cell').style.transform;
      document.hasFocus = originalFocus; window.dispatchEvent(new Event('focus'));
      await pause(1200); running=false; observer.disconnect();longObserver.disconnect();
      const sampleContext = new AudioContext();
      const {buffer} = await fixture.loadRoomEntryCue(sampleContext);
      const expected = fixture.renderRecipe(fixture.createRecipe('soft','wake'), sampleContext.sampleRate);
      let exactSamples = true;
      for (let channel=0;channel<2;channel++) {
        const actual=buffer.getChannelData(channel), wanted=channel ? expected.right : expected.left;
        if (actual.length!==wanted.length) exactSamples=false;
        for (let i=0;i<actual.length;i++) if(actual[i]!==wanted[i]) {exactSamples=false;break;}
      }
      await sampleContext.close();
      const initialEntryPlayed=sources.some(source=>Math.abs(source.duration-buffer.duration)<0.0001);
      const beforeCancelled=sources.length;
      fixture.playUiSound('enter-room'); fixture.cancelDelayedRoomEntryCue(); await pause(40);
      const cancelledEntrySilent = sources.length===beforeCancelled;
      const availabilityRequests=fixture.getAvailabilityRequests();
      const input=document.querySelector('input[aria-label="频道号"]');
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(input,'００００２１'); input.dispatchEvent(new Event('input',{bubbles:true})); await pause(450);
      const manualCode=input.value;
      const manualRechecked=fixture.getAvailabilityRequests()===availabilityRequests+1;
      setter.call(input,'999999'); input.dispatchEvent(new Event('input',{bubbles:true})); await pause(750);
      const errorVisible=root.dataset.state==='error' && [...root.querySelectorAll('.digit-code-cell')].every(cell=>Number(getComputedStyle(cell).opacity)===1);
      AudioBufferSourceNode.prototype.start=nativeStart;
      return {sounds,states,longTasks,maxFrameMs:Math.max(...frames),slowFrames:frames.filter(t=>t>34).length,hiddenPaused,exactSamples,initialEntryPlayed,cancelledEntrySilent,availabilityRequests,manualCode,manualRechecked,errorVisible};
    })()`,
      true,
    );
    console.log(JSON.stringify(result));
    if (
      process.argv.includes("--assert-continuity") &&
      result.states.join(",") !== "checking,success"
    )
      throw Error("one shuffle must have exactly one checking and success transition");
    if (
      process.argv.includes("--assert-cue") &&
      result.sounds.find((sound) => sound.cue === "enter-room").synchronousMs > 5
    )
      throw Error("room entry synchronously synthesizes sound on the renderer");
    if (!result.exactSamples || !result.initialEntryPlayed || !result.cancelledEntrySilent)
      throw Error("entry cue changed samples, failed playback, or played after room cleanup");
    if (!result.hiddenPaused)
      throw Error("digit animation continued while visual runtime was hidden");
    if (!result.errorVisible)
      throw Error("unavailable channel digits stayed hidden after checking");
    if (
      result.availabilityRequests !== 0 ||
      result.manualCode !== "000021" ||
      !result.manualRechecked
    )
      throw Error("random code rechecked or manual leading-zero availability changed");
    if (process.argv.includes("--check-production-worker")) {
      const assets = path.join(__dirname, "../dist/assets");
      const worker = fs
        .readdirSync(assets)
        .find((file) => /^roomEntryCue\.worker-.*\.js$/.test(file));
      if (!worker) throw Error("production entry worker asset missing");
      await view.loadFile(path.join(__dirname, "../dist/index.html"));
      const workerResult = await view.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
        const worker=new Worker(new URL(${JSON.stringify(`./assets/${worker}`)},location.href),{type:'module'});
        const timer=setTimeout(()=>{worker.terminate();reject(Error('production worker timed out'));},2000);
        worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(Error('production worker URL or CSP failure'));};
        worker.onmessage=event=>{clearTimeout(timer);worker.terminate();resolve(event.data.left.length>1000&&event.data.left.length===event.data.right.length);};
        worker.postMessage({sampleRate:48000});
      })`);
      if (!workerResult) throw Error("production worker did not render stereo samples");
      console.log(JSON.stringify({ productionFileWorker: true }));
    }
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
