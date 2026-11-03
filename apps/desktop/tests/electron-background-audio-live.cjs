/* global require, process, console, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const assert = require("node:assert/strict");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "background-audio-live");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => app.exit(1), 40000);
app.whenReady().then(async () => {
  const { NativeChatMixBackend, SettingsStore, registerBackgroundAudioIpc } = require(path.resolve("../../artifacts/chat-mix-native/chat-mix-core.cjs"));
  const view = new BrowserWindow({ show: false, width: 1000, height: 800,
    webPreferences: { preload: path.resolve("dist-electron/preload/index.cjs"), backgroundThrottling: false } });
  ipcMain.handle("app:write-log", () => undefined);
  const executable = path.resolve("resources/native/ShangHao.ChatMix.exe");
  const probe = new NativeChatMixBackend(executable);
  let target, service, writes = 0;
  class ScopedBackend extends NativeChatMixBackend {
    async list() { return target ? (await super.list()).filter(session => session.deviceId === target.deviceId && session.instanceId === target.instanceId && session.processId === target.processId) : []; }
    async change(session, ...args) {
      assert(target && session.deviceId === target.deviceId && session.instanceId === target.instanceId && session.processId === target.processId, "refusing non-fixture audio writes");
      writes++; return super.change(session, ...args);
    }
  }
  try {
    const settings = new SettingsStore(undefined, app.getPath("userData")); await settings.load();
    service = registerBackgroundAudioIpc(() => view, settings, { executable, backend: new ScopedBackend(executable), ownProcesses: () => new Set([process.pid]) });
    await view.loadFile(path.resolve("../../artifacts/native-ui/background-audio.static.html"));
    await view.webContents.executeJavaScript(`window.syntheticContext=new AudioContext();window.syntheticOsc=syntheticContext.createOscillator();window.syntheticGain=syntheticContext.createGain();syntheticGain.gain.value=0;syntheticOsc.connect(syntheticGain);syntheticGain.connect(syntheticContext.destination);syntheticOsc.start();syntheticContext.resume();window.backgroundAudioFixture.speaking(false);`);
    await wait(1000);
    const owned = new Set(app.getAppMetrics().map(metric => metric.pid));
    target = (await probe.list()).find(session => owned.has(session.processId));
    assert(target && target.volume > 0, "isolated synthetic audio session missing; no writes allowed");
    const currentVolume = async () => (await probe.list()).find(session => session.instanceId === target.instanceId && session.deviceId === target.deviceId && session.processId === target.processId)?.volume;
    await view.webContents.executeJavaScript(`document.querySelector('[aria-label="平滑背景声音"]').click()`);
    await wait(400);
    await view.webContents.executeJavaScript(`window.backgroundAudioFixture.speaking(true);setTimeout(()=>window.backgroundAudioFixture.speaking(false),50)`);
    let lowest = target.volume;
    for (let i = 0; i < 10; i++) { await wait(80); lowest = Math.min(lowest, await currentVolume()); }
    assert(lowest <= target.volume * .4, "a 50ms speech edge failed to lower real Windows session volume");
    const copy = await view.webContents.executeJavaScript(`document.querySelector('[data-audio-setting="background-balance"] small').textContent`);
    assert(copy.includes("降低"), "actual attenuation is not shown in the switch");
    await wait(1600);
    assert(Math.abs(await currentVolume() - target.volume) < .0001, "silence did not restore the synthetic session");
    await view.webContents.executeJavaScript(`window.backgroundAudioFixture.speaking(true)`); await wait(500);
    assert(await currentVolume() < target.volume, "continued speech did not reduce volume");
    await view.webContents.executeJavaScript(`document.querySelector('[aria-label="平滑背景声音"]').click();window.backgroundAudioFixture.speaking(false)`);
    await wait(1000);
    assert(Math.abs(await currentVolume() - target.volume) < .0001, "turning off did not restore original volume");
    console.log(JSON.stringify({ productionReactPreloadMainNative: true, shortSpeechMs: 50, lowestRatio: lowest / target.volume,
      restoredAfterSilence: true, restoredWhenDisabled: true, writes, onlyOwnSyntheticSession: true, userApplicationsUntouched: true }));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally {
    if (service) await service.dispose();
    await probe.close();
    await view.webContents.executeJavaScript("window.syntheticOsc?.stop();window.syntheticContext?.close()").catch(() => {});
    view.destroy(); clearTimeout(deadline); app.exit(process.exitCode || 0);
  }
});
