/* global require, process, console, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "background-audio-ui");
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ width: 1100, height: 800, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  view.webContents.setAudioMuted(true);
  view.webContents.on("console-message", event => console.log(event.message));
  try {
    const file = path.resolve("tests/fixtures/background-audio.html").replaceAll("\\", "/");
    if (process.env.SHANGHAO_STATIC_UI === "1") await view.loadFile(path.resolve("../../artifacts/native-ui/background-audio.static.html"));
    else await view.loadURL(`http://127.0.0.1:5174/@fs/${file}`);
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms)),check=(ok,why)=>{if(!ok)throw Error(why)};
      for(let i=0;i<100&&!document.querySelector('[aria-label="平滑背景声音"]');i++)await wait(50);
      const control=document.querySelector('[aria-label="平滑背景声音"]');
      check(control,'single speaker switch missing'); await wait(450);
      check(document.querySelectorAll('[data-audio-setting="background-balance"]').length===1,'duplicate background controls');
      check(control.getAttribute('aria-pressed')==='false','feature enabled by default');
      const idlePulses=document.documentElement.dataset.pulses;await wait(800);
      check(document.documentElement.dataset.pulses===idlePulses,'disabled feature kept polling IPC');
      control.click();control.click(); await wait(150);
      check(document.documentElement.dataset.configurations==='1','same-frame double click submitted twice');
      check(control.getAttribute('aria-pressed')==='true','enabled state not shown');
      document.dispatchEvent(new Event('fixture-stale-state')); await wait(30);
      check(control.getAttribute('aria-pressed')==='true','stale pulse overwrote newer choice');
      document.dispatchEvent(new Event('fixture-mute'));await wait(500);
      check(document.documentElement.dataset.speaking==='false','muted microphone incorrectly lowered background');
      document.dispatchEvent(new Event('fixture-unmute'));await wait(500);
      window.backgroundAudioFixture.speaking(false);await wait(380);
      const previousSpeech=Number(document.documentElement.dataset.speechPulses||0);
      window.backgroundAudioFixture.speaking(true);await wait(45);window.backgroundAudioFixture.speaking(false);await wait(80);
      check(Number(document.documentElement.dataset.speechPulses)>previousSpeech,'short speech between timer ticks was missed');
      window.backgroundAudioFixture.delay(200);
      window.backgroundAudioFixture.speaking(true);await wait(30);window.backgroundAudioFixture.speaking(false);await wait(240);
      const pendingSpeech=Number(document.documentElement.dataset.speechPulses||0);
      window.backgroundAudioFixture.speaking(true);await wait(40);window.backgroundAudioFixture.speaking(false);await wait(450);
      check(Number(document.documentElement.dataset.speechPulses)>pendingSpeech,'speech while IPC was pending was lost');
      window.backgroundAudioFixture.delay(0);window.backgroundAudioFixture.speaking(true);await wait(300);
      const rect=control.getBoundingClientRect();check(rect.left>=0&&rect.top>=0&&rect.right<=innerWidth&&rect.bottom<=innerHeight,'speaker switch clipped');
      const previous=Number(document.documentElement.dataset.pulses);
      document.querySelector('#fixture-switch-page').click();await wait(800);
      check(Number(document.documentElement.dataset.pulses)>previous,'opening settings stopped background activity');
      check(document.documentElement.dataset.speaking==='true','voice activity lost on another page');
      const input=document.querySelector('.shortcut-input-field');check(input,'shortcut settings missing');input.focus();
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'F12',code:'F12',ctrlKey:true,shiftKey:true,bubbles:true}));await wait(150);input.blur();await wait(30);
      check(input.value.includes('F12'),'shortcut result not shown');
      document.querySelector('#fixture-switch-page').click();await wait(100);
      document.dispatchEvent(new Event('fixture-unavailable'));await wait(30);
      check(!document.querySelector('[aria-label="平滑背景声音"]').disabled,'missing helper prevented turning off');
      document.querySelector('[aria-label="平滑背景声音"]').click();await wait(150);
      check(document.querySelector('[aria-label="平滑背景声音"]').getAttribute('aria-pressed')==='false','switch did not turn off');
      return {singleSpeakerSwitch:true,shortSpeechDetected:true,pendingSpeechRetained:true,idlePollingStopped:true,mutedMicrophoneIgnored:true,doubleClickGuard:true,staleReplyGuard:true,backgroundAcrossPages:true,shortcutSetting:true,canDisableWhenUnavailable:true};
    })()`);
    console.log(JSON.stringify(result));
    await require("node:fs/promises").writeFile(path.resolve("../../artifacts/background-audio-switch-20261101.png"), (await view.webContents.capturePage()).toPNG());
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { view.destroy(); clearTimeout(deadline); app.exit(process.exitCode || 0); }
});
