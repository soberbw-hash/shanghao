import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { registerVoiceReplayIpc } from "../src/main/voice-replay-ipc";
import { IPC_CHANNELS } from "@private-voice/shared";
require(
  path.resolve(process.cwd(), "tests/electron-isolated-profile.cjs"),
).configureIsolatedProfile(app, "voice-replay");
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 30000);
void app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    width: 800,
    height: 850,
    webPreferences: {
      backgroundThrottling: false,
      offscreen: true,
      preload: path.resolve("dist-electron/preload/index.cjs"),
    },
  });
  registerVoiceReplayIpc(
    () => view,
    async (filePath, durationMs) => {
      if (
        path.basename(filePath) !== "audio.wav" ||
        durationMs <= 0 ||
        (await fs.stat(filePath)).size <= 44
      )
        throw Error("invalid_local_transcription_input");
      return "合成本地文字";
    },
  );
  ipcMain.handle(IPC_CHANNELS.app.writeLog, () => undefined);
  const keys = Array.from({ length: 12 }, (_, i) => `Ctrl+Alt+F${i + 1}`).filter(
    (key) => !globalShortcut.isRegistered(key),
  );
  const [settingKey, conflictKey] = keys;
  let conflictOwned = false;
  try {
    if (
      !settingKey ||
      !conflictKey ||
      !(conflictOwned = globalShortcut.register(conflictKey, () => {}))
    )
      throw Error("test_shortcuts_unavailable");
    const file = path.resolve("tests/visual/voice-replay.html").replaceAll("\\", "/");
    if (process.env.SHANGHAO_STATIC_UI === "1")
      await view.loadFile(path.resolve("../../artifacts/native-ui/voice-replay.static.html"));
    else
      await view.loadURL(
        `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5174"}/@fs/${file}`,
      );
    const result = await view.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
      const check=(ok, reason)=>{if(!ok)throw Error(reason)};
      const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
      for(let i=0;i<100&&!button('保存刚才对话');i++)await wait(50);
      const tabs=[...document.querySelectorAll('[role="tab"]')];
      check(tabs.length===2,'chat/transcript integration missing');
      tabs[1].click(); await wait(100);
      const toolbar=document.querySelector('.room-chronicle-toolbar');
      check(toolbar.contains(button('保存刚才对话')),'save control not inside transcript toolbar');
      check(toolbar.scrollWidth<=toolbar.clientWidth+1,'transcript controls clipped');
      button('保存刚才对话').click(); await wait(100);
      check(button('开启原声缓冲'), 'consent prompt missing');
      check(!document.querySelector('.voice-replay-dialog input'), 'shortcut still occupies the save dialog');
      button('开启原声缓冲').click();
      await wait(2400);
      document.querySelector('[aria-label="关闭语音回溯"]').click(); await wait(50);
      tabs[0].click(); await wait(500);
      check(document.querySelector('.chat-composer'),'chat did not return');
      tabs[1].click(); await wait(50);
      button('保存刚才对话').click(); await wait(50);
      button('保存片段').click(); await wait(400);
      const clips=await window.desktopApi.voiceReplay.list();
      check(clips.length===1,'clip not saved through real IPC');
      const bytes=await window.desktopApi.voiceReplay.read(clips[0].id);
      check(await window.desktopApi.voiceReplay.transcribeLocal(clips[0].id)==='合成本地文字','local transcription IPC failed');
      const decode=new AudioContext();
      const audio=await decode.decodeAudioData(Uint8Array.from(bytes).buffer);
      const peak=Math.max(...audio.getChannelData(0).subarray(0,10000).map(Math.abs));
      check(audio.duration>1&&peak>0.1,'PCM capture missing actual audio');
      check(audio.duration>2.4,'switching to chat restarted the replay buffer');
      const consent=document.querySelector('.voice-replay-consent');
      check(!consent.open,'active consent controls should be collapsed');
      consent.querySelector('summary').click();await wait(50);
      button('停止保留我的声音').click(); await wait(100);
      check(button('保存片段').disabled,'withdrawal did not disable saving');
      check(window.replayFixture.inputLive(),'withdrawal stopped room microphone');
      button('同意保留我的声音').click(); await wait(600);
      button('保存片段').click(); await wait(300);
      const after=await window.desktopApi.voiceReplay.list();
      check(after.length===2,'second clip missing');
      check(after[0].durationMs<1200,'old PCM survived withdrawal');
      button('精彩片段').click(); await wait(200);
      const rows=[...document.querySelectorAll('.voice-replay-clips button')];
      check(rows.length===2,'repeat save did not refresh visible library');
      rows[1].click(); await wait(150);
      check(document.querySelector('.voice-replay-editor audio'),'clip playback unavailable');
      const numberFields=[...document.querySelectorAll('.voice-replay-trim input')];
      const setInput=(input,value)=>{
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
        input.dispatchEvent(new Event('input',{bubbles:true}));
      };
      setInput(numberFields[0],'0.1'); setInput(numberFields[1],'0.5'); await wait(50);
      button('另存裁剪').click(); await wait(250);
      const trimmed=await window.desktopApi.voiceReplay.list();
      check(trimmed.length===3,'trim did not save new clip');
      check(trimmed[0].durationMs===400,'trim control did not apply selected range');
      check(document.querySelectorAll('.voice-replay-clips button').length===3,'trim did not refresh visible library');
      check(window.replayFixture.inputLive(),'library damaged room microphone');
      document.querySelector('[aria-label="关闭精彩片段"]').click(); await wait(50);
      document.querySelector('[aria-label="关闭语音回溯"]').click(); await wait(50);
      tabs[0].click(); await wait(100);
      document.querySelector('#fixture-toggle-settings').click(); await wait(80);
      const input=document.querySelector('.shortcut-input-field');check(input,'shortcut missing from settings');
      const key=${JSON.stringify(settingKey)}, conflict=${JSON.stringify(conflictKey)};
      const bind=value=>{const name=value.split('+').at(-1);input.dispatchEvent(new KeyboardEvent('keydown',{key:name,code:name,ctrlKey:true,altKey:true,bubbles:true}));};
      bind(key);await wait(150);
      check(localStorage.getItem('voice-replay-shortcut')===key,'settings binding was not persisted');
      bind(conflict);await wait(150);
      check(localStorage.getItem('voice-replay-shortcut')===key,'conflict replaced the working binding');
      check(document.body.textContent.includes('原设置保留'),'shortcut conflict feedback missing');
      await decode.close();
      return {ok:true,duration:audio.duration,peak,clips:3,inputStillLive:true,settingsBinding:true,conflictPreserved:true};
    })()`);
    // Notify only this isolated window through the production Preload channel, without sending OS keys.
    const beforeShortcut = await view.webContents.executeJavaScript(
      `window.desktopApi.voiceReplay.list().then(x=>x.length)`,
    );
    if (beforeShortcut !== 3) throw Error(`unexpected_count_before_shortcut:${beforeShortcut}`);
    view.webContents.send(IPC_CHANNELS.voiceReplay.saveShortcut);
    await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      for(let i=0;i<30&&(await window.desktopApi.voiceReplay.list()).length<4;i++)await wait(100);
      const count=(await window.desktopApi.voiceReplay.list()).length;
      if(count!==4)throw Error('shortcut saved an unexpected number of clips: '+count);
      document.querySelector('#fixture-toggle-settings').click();await wait(50);
      document.querySelectorAll('[role="tab"]')[1].click();await wait(100);
      [...document.querySelectorAll('button')].find(button=>button.textContent==='保存刚才对话').click();await wait(100);
    })()`);
    await view.webContents.executeJavaScript("window.replayFixture.close()");
    console.log(JSON.stringify({ ...result, clips: 4, savedFromChatShortcut: true }));
    if (conflictOwned) globalShortcut.unregister(conflictKey);
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    if (conflictOwned) globalShortcut.unregister(conflictKey);
    console.error(String(error));
    clearTimeout(deadline);
    app.exit(1);
  }
});
