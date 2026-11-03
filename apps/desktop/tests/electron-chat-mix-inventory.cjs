/* global require, process, console, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require("electron");
const { execFile, spawn } = require("node:child_process");
const readline = require("node:readline");
const { promisify } = require("node:util");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "chat-mix-inventory");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 45000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await view.loadURL("data:text/html,<title>Isolated audio inventory</title>");
    await view.webContents.executeJavaScript(`window.testContext=new AudioContext();window.testOscillator=testContext.createOscillator();window.testGain=testContext.createGain();testGain.gain.value=0;testOscillator.connect(testGain);testGain.connect(testContext.destination);testOscillator.start();testContext.resume()`);
    await new Promise(resolve => setTimeout(resolve, 1200));
    const { stdout } = await promisify(execFile)(path.resolve("../../artifacts/chat-mix-native/ShangHao.ChatMixInventory.exe"), ["--list"], { windowsHide: true, timeout: 5000 });
    const sessions = JSON.parse(stdout);
    if (!Array.isArray(sessions) || sessions.some(s => !Number.isInteger(s.processId) || s.processId <= 0 || s.volume < 0 || s.volume > 1)) throw Error("invalid inventory");
    console.log(JSON.stringify({ readOnly: true, sessionCount: sessions.length, syntheticAudioSessionObserved: sessions.length > 0 }));
    const ownedPids = new Set(app.getAppMetrics().map(metric => metric.pid));
    ownedPids.add(view.webContents.getOSProcessId());
    const target = sessions.find(session => ownedPids.has(session.processId));
    if (!target) throw Error("isolated synthetic session was not identified; refusing any volume write");
    const helper = spawn(path.resolve("../../artifacts/chat-mix-native/ShangHao.ChatMixInventory.exe"), ["--pipe"], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    const lines = readline.createInterface({ input: helper.stdout });
    const pending = [];
    lines.on("line", line => pending.shift()?.(JSON.parse(line)));
    const change = (expected, value) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("synthetic volume response timed out")), 3000);
      pending.push(result => { clearTimeout(timer); resolve(result); });
      helper.stdin.write(JSON.stringify({ deviceId: target.deviceId, instanceId: target.instanceId, processId: target.processId, expected, value, original: target.volume }) + "\n");
    });
    let latest = target.volume;
    try {
      for (const value of [.5, .25, .6]) {
        const result = await change(latest, value);
        if (!result.ok) throw Error("synthetic volume change failed");
        latest = value;
      }
      const conflict = await change(.25, target.volume);
      if (conflict.ok || !conflict.conflict) throw Error("external volume override was not protected");
      const restore = await change(latest, target.volume);
      if (!restore.ok) throw Error("synthetic original volume was not restored");
      latest = target.volume;
      console.log(JSON.stringify({ syntheticOnlyVolumeChange: true, conflictGuard: true, originalRestored: true }));
    } finally {
      if (latest !== target.volume) await change(latest, target.volume).catch(() => {});
      const ended = new Promise(resolve => helper.once("exit", resolve));
      helper.stdin.end(); lines.close(); await ended;
    }
    const { NativeChatMixBackend, ChatMixVolumeLeases, chatMixLeaseJournal, ChatMixController } = require(path.resolve("../../artifacts/chat-mix-native/chat-mix-core.cjs"));
    const executable = path.resolve("../../artifacts/chat-mix-native/ShangHao.ChatMixInventory.exe");
    const journal = chatMixLeaseJournal(path.join(app.getPath("userData"), "synthetic-volume-leases.json"));
    let backend = new NativeChatMixBackend(executable);
    try {
      const owner = await ChatMixVolumeLeases.open(backend, journal);
      if (!await owner.attenuate(target, .5, new Set())) throw Error("real bridge attenuation failed");
      const reduced = (await backend.list()).find(item => item.instanceId === target.instanceId);
      if (!reduced || Math.abs(reduced.volume - target.volume * .5) > .0001) throw Error("native gain not applied");
      backend.child.kill(); // Fault injection: only this fixture's own native worker.
      await backend.close();
      backend = new NativeChatMixBackend(executable);
      const restarted = await ChatMixVolumeLeases.open(backend, journal);
      if ((await restarted.restore()).pending) throw Error("native journal recovery incomplete");
      const restored = (await backend.list()).find(item => item.instanceId === target.instanceId);
      if (!restored || Math.abs(restored.volume - target.volume) > .0001) throw Error("native journal recovery did not restore original volume");
      console.log(JSON.stringify({ realMainAdapter: true, durableJournal: true, workerRecreated: true, originalRestored: true }));
      if (!await restarted.attenuate(target, .5, new Set())) throw Error("EOF recovery setup failed");
      await backend.close();
      backend = new NativeChatMixBackend(executable);
      const eofRestored = (await backend.list()).find(item => item.instanceId === target.instanceId);
      if (!eofRestored || Math.abs(eofRestored.volume - target.volume) > .0001) throw Error("native EOF did not restore original");
      await backend.close();
      console.log(JSON.stringify({ parentPipeClosed: true, nativeRestoredWithoutMain: true }));
      // No keepalive: simulate a suspended parent without requiring a user process to be stopped.
      const watchdog = spawn(executable, ["--pipe"], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
      const output = readline.createInterface({ input: watchdog.stdout });
      const reply = new Promise(resolve => output.once("line", line => resolve(JSON.parse(line))));
      watchdog.stdin.write(JSON.stringify({ ...target, expected: target.volume, value: target.volume * .5, original: target.volume }) + "\n");
      if (!(await reply).ok) throw Error("watchdog setup failed");
      await new Promise(resolve => watchdog.once("exit", resolve));
      output.close();
      backend = new NativeChatMixBackend(executable);
      const timeoutRestored = (await backend.list()).find(item => item.instanceId === target.instanceId);
      if (!timeoutRestored || Math.abs(timeoutRestored.volume - target.volume) > .0001) throw Error("native inactivity watchdog did not restore original");
      console.log(JSON.stringify({ parentSuspended: true, nativeWatchdogRestored: true }));
      const rampOwner = await ChatMixVolumeLeases.open(backend, journal);
      let now = 0;
      const rampValues = [];
      const controller = new ChatMixController({
        // The only writable target remains this fixture's own silent synthetic session.
        list: async () => (await backend.list()).filter(session => session.instanceId === target.instanceId && ownedPids.has(session.processId)),
        attenuate: async (session, factor, excluded) => {
          if (!ownedPids.has(session.processId)) throw Error("refusing foreign volume change");
          const result = await rampOwner.attenuate(session, factor, excluded);
          const current = (await backend.list()).find(item => item.instanceId === target.instanceId);
          rampValues.push(current.volume); return result;
        },
        ownProcesses: () => new Set([process.pid]), restore: () => rampOwner.restore(),
      }, () => now);
      await controller.tick();
      for (now = 100; now <= 300; now += 100) { controller.update({ enabled: true, inRoom: true, speaking: true }); await controller.tick(); }
      if (!(rampValues[0] > rampValues[1] && rampValues[1] > rampValues[2])) throw Error("real native ramp did not descend smoothly");
      for (now = 1500; now <= 2300; now += 100) { controller.update({ enabled: true, inRoom: true, speaking: false }); await controller.tick(); }
      await controller.stop();
      if ((await journal.read()).length) throw Error("native ramp left a stale recovery lease");
      console.log(JSON.stringify({ realNativeSmoothRamp: true, automaticRelease: true, journalCleared: true }));
      const keepaliveOwner = await ChatMixVolumeLeases.open(backend, journal);
      if (!await keepaliveOwner.attenuate(target, .5, new Set())) throw Error("keepalive setup failed");
      await new Promise(resolve => setTimeout(resolve, 9000));
      const maintained = (await backend.list()).find(item => item.instanceId === target.instanceId);
      if (!maintained || Math.abs(maintained.volume - target.volume * .5) > .0001) throw Error("healthy worker lost its keepalive");
      await backend.close();
      backend = new NativeChatMixBackend(executable);
      const aliveRestored = (await backend.list()).find(item => item.instanceId === target.instanceId);
      if (!aliveRestored || Math.abs(aliveRestored.volume - target.volume) > .0001) throw Error("keepalive shutdown did not restore original");
      console.log(JSON.stringify({ healthyKeepalive: true, gracefulRestore: true }));
    } finally { await backend.close(); }
    await view.webContents.executeJavaScript("testOscillator.stop();testContext.close()");
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { view.destroy(); clearTimeout(deadline); app.exit(process.exitCode || 0); }
});
