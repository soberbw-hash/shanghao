import { app, BrowserWindow, ipcMain } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { registerRecordingRecycleIpc } from "../src/main/recording-recycle-ipc";
import { readRecordingLibraryFromDirectory } from "../src/main/recording-library-core";
import { SharedVoiceMemoryStore } from "../src/main/shared-voice-memory-store";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { defaultSettings } from "../src/main/settings-migration";
import { IPC_CHANNELS } from "@private-voice/shared";
const root = require(path.resolve("tests/electron-isolated-profile.cjs")).configureIsolatedProfile(
  app,
  "recording-recycle",
);
app.disableHardwareAcceleration();
const timeout = setTimeout(() => app.exit(1), 30_000);
void app.whenReady().then(async () => {
  const directory = path.join(root, "recordings");
  await fs.mkdir(directory);
  const file = path.join(directory, "晚上 · 朋友的神级发言.m4a");
  await fs.writeFile(file, "isolated audio fixture");
  const item = (await readRecordingLibraryFromDirectory(directory, 20)).items[0]!;
  const memory = new SharedVoiceMemoryStore(path.join(root, "memory"));
  await memory.initialize();
  await memory.save(
    createEmptyVoiceMemoryRecord({ recordingId: item.recordingId, filePath: file }),
  );
  const view = new BrowserWindow({
    width: 780,
    height: 540,
    show: false,
    webPreferences: {
      offscreen: true,
      preload: path.resolve("dist-electron/preload/index.cjs"),
      backgroundThrottling: false,
    },
  });
  registerRecordingRecycleIpc(
    () => ({ ...defaultSettings, recordingSaveDirectory: directory }),
    () => view,
    {
      setRecycled: (id: string, token: string, value: boolean) =>
        memory.setRecycled(id, token, value),
      delete: (id: string) => memory.delete(id),
    } as never,
    (error) => console.error(error),
    async () => undefined,
  );
  ipcMain.handle(IPC_CHANNELS.app.writeLog, () => undefined);
  try {
    const url = path.resolve("tests/visual/recording-recycle.html").replaceAll("\\", "/");
    await view.loadURL(`${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5174"}/@fs/${url}`);
    const result = await view.webContents.executeJavaScript(`(async () => {
      const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
      const check = (ok,why) => { if(!ok) throw Error(why); };
      const button = text => [...document.querySelectorAll('button')].find(b => b.textContent===text);
      for(let i=0;i<100&&!button('回收站');i++)await wait(50);
      check(button('回收站'),'real preload capability missing');
      await window.desktopApi.recording.delete(${JSON.stringify(file)});
      check((await window.desktopApi.recordingRecycle.list()).length===1,'real delete failed to recycle');
      button('回收站').click(); await wait(350);
      check(document.querySelector('dialog').open,'StrictMode closed dialog');
      check(document.querySelectorAll('dialog li').length===1,'archived recording missing from UI');
      const reject = await window.desktopApi.recordingRecycle.restore('../outside').then(()=>false,()=>true);
      check(reject,'unvalidated restore id');
      button('恢复').click(); await wait(500);
      check(document.body.dataset.restored==='true','library not refreshed after restore');
      check((await window.desktopApi.recordingRecycle.list()).length===0,'restore did not remove archive');
      document.querySelector('[aria-label="关闭回收站"]').click(); await wait(80);
      button('回收站').click(); await wait(200);
      check(document.querySelector('dialog').open,'dialog cannot reopen');
      document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true})); await wait(80);
      check(!document.querySelector('dialog'),'escape did not close');
      button('回收站').click(); await wait(150);
      return {ok:true,productionIpc:true,strictMode:true,restored:true,closeAndReopen:true};
    })()`);
    const restored = (await readRecordingLibraryFromDirectory(directory, 20)).items[0]!;
    if (
      restored.recordingId !== item.recordingId ||
      (await fs.readFile(file, "utf8")) !== "isolated audio fixture"
    )
      throw Error("restore_identity_or_bytes_changed");
    await fs.writeFile(
      path.resolve("../../artifacts/recording-recycle-20261031.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
    console.log(JSON.stringify(result));
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    app.exit(1);
  }
});
