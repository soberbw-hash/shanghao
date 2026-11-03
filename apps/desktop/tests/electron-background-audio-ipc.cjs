/* global require, process, console, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, globalShortcut, ipcMain } = require("electron");
const path = require("node:path");
const assert = require("node:assert/strict");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "background-audio-ipc");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  ipcMain.handle("app:write-log", () => undefined);
  const preload = path.resolve("dist-electron/preload/index.cjs");
  const window = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, backgroundThrottling: false } });
  const stranger = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true } });
  let service;
  try {
    const { NativeChatMixBackend, SettingsStore, registerBackgroundAudioIpc } = require(path.resolve("../../artifacts/chat-mix-native/chat-mix-core.cjs"));
    const executable = path.resolve("resources/native/ShangHao.ChatMix.exe");
    await window.loadURL("data:text/html,<title>Isolated background audio IPC</title>");
    await stranger.loadURL("data:text/html,<title>Untrusted test window</title>");
    if (process.argv.includes("--missing-helper")) {
      const missing = path.join(app.getPath("userData"), "missing.ChatMix.exe");
      const settings = new SettingsStore(undefined, app.getPath("userData")); await settings.load();
      await settings.save({ isBackgroundAudioBalanceEnabled: true, backgroundAudioBalanceShortcut: "Ctrl+Shift+F12" });
      service = registerBackgroundAudioIpc(() => window, settings, { executable: missing, backend: new NativeChatMixBackend(missing) });
      const unavailable = await window.webContents.executeJavaScript("desktopApi.backgroundAudio.pulse({inRoom:false,speaking:false})");
      assert.equal(unavailable.available, false); assert.equal(globalShortcut.isRegistered("Ctrl+Shift+F12"), false);
      const disabled = await window.webContents.executeJavaScript("desktopApi.backgroundAudio.configure({enabled:false,shortcut:''})");
      assert.equal(disabled.enabled, false); assert.equal(disabled.shortcut, "");
      await assert.rejects(window.webContents.executeJavaScript("desktopApi.backgroundAudio.configure({enabled:true})"), /unavailable/);
      console.log(JSON.stringify({ missingHelperDoesNotBindShortcut: true, disabledWithoutHelper: true, cannotEnableWithoutHelper: true }));
      return;
    }
    await window.webContents.executeJavaScript(`window.context=new AudioContext();window.osc=context.createOscillator();window.gain=context.createGain();gain.gain.value=0;osc.connect(gain);gain.connect(context.destination);osc.start();context.resume()`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const owned = new Set(app.getAppMetrics().map(metric => metric.pid));
    const probe = new NativeChatMixBackend(executable);
    const target = (await probe.list()).find(session => owned.has(session.processId));
    assert(target, "synthetic test session must exist");
    await probe.close();
    let writes = 0;
    class ScopedBackend extends NativeChatMixBackend {
      async list() { return (await super.list()).filter(session => owned.has(session.processId)); }
      async change(session, ...args) {
        assert(owned.has(session.processId), "refusing any volume write outside this isolated test tree");
        writes++; return super.change(session, ...args);
      }
    }
    const settings = new SettingsStore(undefined, app.getPath("userData"));
    await settings.load();
    assert.equal(settings.getSnapshot().isBackgroundAudioBalanceEnabled, false);
    service = registerBackgroundAudioIpc(() => window, settings, { executable, backend: new ScopedBackend(executable) });
    await assert.rejects(stranger.webContents.executeJavaScript("desktopApi.backgroundAudio.configure({enabled:true})"), /forbidden/);
    await assert.rejects(window.webContents.executeJavaScript("desktopApi.backgroundAudio.configure({enabled:true,processId:1})"), /invalid_configuration/);
    await assert.rejects(window.webContents.executeJavaScript("desktopApi.backgroundAudio.configure({shortcut:'F2'})"), /shortcut_unavailable/);
    const enabled = await window.webContents.executeJavaScript("desktopApi.backgroundAudio.configure({enabled:true})");
    assert.equal(enabled.available, true); assert.equal(enabled.enabled, true);
    for (let i = 0; i < 4; i++) {
      await window.webContents.executeJavaScript("desktopApi.backgroundAudio.pulse({inRoom:true,speaking:true})");
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(writes, 0, "production process inventory must exclude its own renderer and audio utility");
    const reloaded = new SettingsStore(undefined, app.getPath("userData"));
    await reloaded.load(); assert.equal(reloaded.getSnapshot().isBackgroundAudioBalanceEnabled, true);
    let bound;
    for (const key of ["Ctrl+Shift+F12", "Ctrl+Alt+F11", "Ctrl+Alt+F10"]) {
      try { await window.webContents.executeJavaScript(`desktopApi.backgroundAudio.configure({shortcut:${JSON.stringify(key)}})`); bound = key; break; }
      catch { /* Do not steal an unavailable system shortcut. */ }
    }
    assert(bound, "no free synthetic shortcut candidate"); assert(globalShortcut.isRegistered(bound));
    await settings.save({ backgroundAudioBalanceShortcut: "" });
    await new Promise(resolve => setTimeout(resolve, 120));
    await window.webContents.executeJavaScript("desktopApi.backgroundAudio.pulse({inRoom:false,speaking:false})");
    assert.equal(globalShortcut.isRegistered(bound), false, "a settings reset must release the old shortcut");
    await window.webContents.executeJavaScript("desktopApi.backgroundAudio.configure({enabled:false,shortcut:''})");
    assert.equal(globalShortcut.isRegistered(bound), false);
    await service.dispose(); service = undefined;
    await window.webContents.executeJavaScript("osc.stop();context.close()");
    console.log(JSON.stringify({ realPreloadAndMainIpc: true, defaultOff: true, ownAudioUntouched: true,
      settingsPersisted: true, otherWindowRejected: true, arbitraryPidRejected: true, shortcutRegisteredAndReleased: true, resetReleasesShortcut: true, userAppsUntouched: true }));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { if (service) await service.dispose(); window.destroy(); stranger.destroy(); clearTimeout(deadline); app.exit(process.exitCode || 0); }
});
