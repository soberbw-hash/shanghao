/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "audio-device-presets");
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ show: false, width: 900, height: 700,
    webPreferences: { backgroundThrottling: false, offscreen: true } });
  try {
    view.webContents.setAudioMuted(true);
    const file = path.resolve("tests/visual/audio-device-presets.html").replaceAll("\\", "/");
    if (process.env.SHANGHAO_STATIC_FIXTURE) await view.loadFile(path.resolve("../../artifacts/native-ui/audio-device-presets.static.html"));
    else await view.loadURL(`${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5174"}/@fs/${file}`);
    const result = await view.webContents.executeJavaScript(`(async () => {
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const check=(ok,reason)=>{if(!ok)throw Error(reason)};
      for(let i=0;i<100&&!window.audioPresetFixture;i++)await wait(50);
      const fixture=window.audioPresetFixture;
      fixture.connection('disconnected'); window.audioPresetKey(); await wait(150);
      check(fixture.switches===0&&fixture.settings().microphoneSendVolume===1,'disconnected room accepted a switch');
      fixture.connection('waiting_peer');
      fixture.blockProcessing(true); window.audioPresetKey(); await wait(100);
      check(fixture.switches===0&&fixture.settings().microphoneSendVolume===1,'busy processing still changed audio settings');
      fixture.blockProcessing(false);
      window.audioPresetKey(); await wait(500);
      check(fixture.settings().microphoneSendVolume===1.2,'hotkey did not choose the other profile');
      check(!fixture.liveTrack().enabled,'preset opened a previously muted microphone');
      fixture.unmute(); window.audioPresetKey(); await wait(500);
      check(fixture.settings().microphoneSendVolume===1,'second hotkey did not return');
      check(fixture.liveTrack().enabled,'send gate did not restore existing unmuted state');
      check(fixture.gateWasClosed,'input was open during a transaction');
      check(fixture.route()==='applied','output route not verified');
      [...document.querySelectorAll('button')].find(b=>b.textContent==='打开设备').click(); await wait(100);
      check(document.querySelector('.audio-device-presets-host button'),'profile entry did not mount in device menu');
      [...document.querySelectorAll('button')].find(b=>b.textContent==='音频配置').click(); await wait(100);
      const rows=document.querySelectorAll('.audio-preset-row');
      check(rows.length===2,'two profiles missing');
      check(document.querySelectorAll('.audio-presets-dialog select').length===4,'device selectors missing');
      check(!document.querySelector('.audio-presets-dialog .shortcut-input-wrap'),'shortcut still occupies the dialog');
      fixture.markMissing(); await wait(50);
      const count=fixture.switches;
      rows[1].querySelector('.audio-preset-switch').click(); await wait(500);
      check(fixture.switches===count,'missing device still changed input');
      check(fixture.liveTrack().enabled,'preflight failure interrupted current voice');
      check(document.querySelector('[role=status]').textContent.includes('麦克风已断开'),'missing device explanation absent');
      fixture.stall(); window.audioPresetKey();
      for(let i=0;i<40&&!fixture.isPending();i++)await wait(50);
      check(fixture.isPending(),'pending switch fixture did not start');
      fixture.jump(); await wait(100); fixture.openNewTrack();
      check(fixture.liveTrack().enabled,'old transaction held the next room microphone');
      fixture.release(); await wait(150);
      check(fixture.liveTrack().enabled,'late transaction muted next room');
      check(fixture.settings().microphoneSendVolume===1.45,'late transaction overwrote next room settings');
      const first=document.querySelector('.audio-preset-row');
      const name=first.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(name,'新的桌面配置');
      name.dispatchEvent(new Event('input',{bubbles:true})); await wait(30);
      const setSelect=(element,value)=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('change',{bubbles:true}));};
      const beforeDraft=fixture.switches;
      setSelect(first.querySelectorAll('select')[0],'fixture-mic');
      setSelect(first.querySelectorAll('select')[1],'fixture-speaker'); await wait(30);
      check(fixture.settings().preferredInputDeviceId===undefined&&fixture.switches===beforeDraft,'draft changed the live microphone');
      check(first.querySelector('.audio-preset-switch').disabled,'unsaved draft can be applied as old settings');
      const save=[...first.querySelectorAll('button')].find(b=>b.textContent==='保存');
      const writes=fixture.writes(); save.click();save.click(); await wait(180);
      check(fixture.writes()===writes+1,'same-frame save wrote twice');
      check(fixture.settings().audioDevicePresets[0].name==='新的桌面配置','edited profile name was not saved');
      check(fixture.settings().audioDevicePresets[0].audio.preferredInputDeviceId==='fixture-mic'&&fixture.settings().audioDevicePresets[0].audio.preferredOutputDeviceId==='fixture-speaker','selected device pair was not saved');
      check(fixture.switches===beforeDraft,'saving changed the live call');
      check(fixture.settings().audioDevicePresets[0].audio.microphoneSendVolume===1.45,'current processing/volume was not captured');
      check(fixture.settings().audioDevicePresets[1].audio.microphoneSendVolume===1.2,'saving one profile replaced the other');
      setSelect(first.querySelectorAll('select')[1],''); await wait(20);save.click();await wait(140);
      const bounds=first.getBoundingClientRect();
      check(document.elementFromPoint(bounds.left+22,bounds.bottom-24)?.closest('.audio-preset-state'),'visible switch is not clickable');
      first.querySelector('.audio-preset-state').click();await wait(400);
      check(fixture.settings().preferredInputDeviceId==='fixture-mic','saved microphone pair was not applied');
      check(first.classList.contains('is-active')&&first.querySelector('.audio-preset-switch').getAttribute('aria-pressed')==='true','applied card has no active feedback');
      check(fixture.liveTrack().enabled,'applying saved draft broke the outgoing gate');
      fixture.failSave();setSelect(first.querySelectorAll('select')[1],'fixture-speaker');await wait(20);save.click();await wait(150);
      check(document.querySelector('.audio-presets-dialog [role=status]').textContent.includes('未保存'),'failed save reported success');
      check(!fixture.settings().audioDevicePresets[0].audio.preferredOutputDeviceId,'failed save replaced saved config');
      [...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='关闭音频配置').click();await wait(50);
      const shortcut=document.querySelector('#fixture-shortcut-settings input');
      const press=key=>shortcut.dispatchEvent(new KeyboardEvent('keydown',{key,code:key,ctrlKey:true,shiftKey:true,bubbles:true}));
      press('F9');await wait(150);check(fixture.settings().audioDevicePresetShortcut==='Ctrl+Shift+F9','settings shortcut did not save');
      press('F10');await wait(150);check(fixture.settings().audioDevicePresetShortcut==='Ctrl+Shift+F9','shortcut conflict replaced working key');
      fixture.empty();await wait(30);[...document.querySelectorAll('button')].find(b=>b.textContent==='音频配置').click();await wait(60);
      check(document.querySelector('[aria-label="配置 1 名称"]').value==='配置一'&&document.querySelector('[aria-label="配置 2 名称"]').value==='配置二','new default names wrong');
      const cards=[...document.querySelectorAll('.audio-preset-row')];
      cards[0].querySelector('.audio-preset-actions button:last-child').click();await wait(150);
      cards[1].querySelector('.audio-preset-actions button:last-child').click();await wait(150);
      cards[1].querySelector('.audio-preset-state').click();await wait(400);
      check(cards[1].classList.contains('is-active')&&!cards[0].classList.contains('is-active'),'second card did not become the sole active card');
      return {ok:true,switches:count,gateWasClosed:fixture.gateWasClosed,roomChangeSafe:true,profileSave:true,draftDevices:true,clickableCards:true,doubleSaveGuard:true,settingsShortcut:true,outputRoute:fixture.route()};
    })()`);
    const geometry=[];
    for (const width of [900, 520, 360]) {
      view.setSize(width, 740);
      await new Promise(resolve=>setTimeout(resolve,100));
      geometry.push(await view.webContents.executeJavaScript(`(() => {
        const dialog=document.querySelector('.audio-presets-dialog'), cards=[...document.querySelectorAll('.audio-preset-row')];
        if(dialog.scrollWidth>dialog.clientWidth+1) throw Error('dialog horizontal overflow');
        for(const card of cards) for(const control of card.querySelectorAll('input,select')) {
          const c=control.getBoundingClientRect(), b=card.getBoundingClientRect();
          if(c.left<b.left||c.right>b.right+1)throw Error('device control escaped its card');
        }
        return {width:innerWidth,height:dialog.getBoundingClientRect().height,columns:cards[0].getBoundingClientRect().top===cards[1].getBoundingClientRect().top?2:1};
      })()`));
    }
    view.setSize(900,740);await new Promise(resolve=>setTimeout(resolve,100));
    const screenshot=path.resolve("../../artifacts/audio-device-presets-cards-20261101.png");
    await fs.writeFile(screenshot,(await view.webContents.capturePage()).toPNG());
    await view.webContents.executeJavaScript("window.audioPresetFixture.close()");
    console.log(JSON.stringify({...result,geometry,screenshot}));
    clearTimeout(deadline);app.exit(0);
  } catch(error) { console.error(String(error));clearTimeout(deadline);app.exit(1); }
});
