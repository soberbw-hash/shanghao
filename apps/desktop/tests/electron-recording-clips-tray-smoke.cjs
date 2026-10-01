/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, setTimeout, clearTimeout, console, process */
const { app, BrowserWindow, ipcMain, dialog, shell, Notification } = require("electron");
const { EventEmitter } = require("node:events");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "clip-tray-review");
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
require("tsx/cjs");
const { registerBackgroundDesktop } = require("../src/main/background-desktop.ts");
const { registerRecordingClipIpc } = require("../src/main/recording-clip-ipc.ts");
const { createTrayController } = require("../src/main/tray.ts");
const { defaultSettings } = require("../src/main/settings-migration.ts");
const { resolveFfmpegExecutable } = require("../src/main/media-runtime.ts");
const { runLocalProcess } = require("../src/main/local-process.ts");
const {
  registerRecordingInDirectory,
  readRecordingLibraryItems,
} = require("../src/main/recording-library-core.ts");
const deadline = setTimeout(() => app.exit(1), 45_000);
app.whenReady().then(async () => {
  let win, tray, background;
  const artifact = path.resolve(__dirname, "../../../test-artifacts");
  try {
    app.getAppPath = () => path.resolve(__dirname, "..");
    const directory = path.join(app.getPath("userData"), "recordings");
    await fs.mkdir(directory);
    let config = {
      ...defaultSettings,
      recordingSaveDirectory: directory,
      minimizeToTray: true,
      isSystemNotificationEnabled: false,
    };
    const settings = {
      getSnapshot: () => config,
      save: async (patch) => {
        config = { ...config, ...patch };
        return config;
      },
    };
    const source = path.join(directory, "上号-20261001-210000.m4a");
    await runLocalProcess(
      resolveFfmpegExecutable(),
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=60",
        "-c:a",
        "aac",
        "-b:a",
        "32k",
        source,
      ],
      { timeoutMs: 15_000 },
    );
    await registerRecordingInDirectory(directory, source);
    await fs.writeFile(
      source.replace(/\.m4a$/, "-精彩时刻.txt"),
      "上号录音 · 精彩时刻\n1. 00:00:30\n",
    );
    const recording = (await readRecordingLibraryItems(directory))[0];
    const audioUrl = `data:audio/mp4;base64,${(await fs.readFile(source)).toString("base64")}`;
    ipcMain.handle("review:load", () => ({ settings: config, recording, audioUrl }));
    ipcMain.handle("review:save", (_event, patch) => settings.save(patch));
    win = new BrowserWindow({
      show: false,
      width: 960,
      height: 720,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        preload: path.join(__dirname, "fixtures/recording-clips-preload.cjs"),
      },
    });
    win.webContents.on("console-message", (event) => {
      if (event.level === "error") console.error(event.message);
    });
    const accounts = Object.assign(new EventEmitter(), {
      getSnapshot: () => ({ status: "signed_in", profile: { userId: "test-user" } }),
    });
    let queries = 0,
      hidden = 0,
      response = 2,
      dragFile,
      revealedFile,
      menu,
      tooltip;
    let notices = 0;
    const shownNotifications = [];
    const watchedRoom = {
      roomId: `room_${"a".repeat(32)}`,
      name: "测试房间",
      onlineCount: 0,
      capacity: 5,
    };
    Notification.isSupported = () => true;
    Notification.prototype.show = function () {
      notices++;
      shownNotifications.push(this);
    };
    const originalHide = win.hide.bind(win);
    win.hide = () => {
      hidden++;
      originalHide();
    };
    win.webContents.startDrag = ({ file, icon }) => {
      assert.equal(icon.isEmpty(), false);
      dragFile = file;
    };
    shell.showItemInFolder = (file) => {
      revealedFile = file;
    };
    dialog.showMessageBox = async (_window, options) => {
      assert.equal(options.defaultId, 0);
      assert.equal(options.cancelId, 2);
      assert.equal(options.buttons.length, 3);
      return { response, checkboxChecked: false };
    };
    tray = createTrayController(
      () => win,
      () => false,
      () => {
        void background.hide();
      },
    );
    const originalTip = tray.setToolTip.bind(tray),
      originalMenu = tray.setContextMenu.bind(tray);
    tray.setToolTip = (value) => {
      tooltip = value;
      originalTip(value);
    };
    tray.setContextMenu = (value) => {
      menu = value;
      originalMenu(value);
    };
    background = registerBackgroundDesktop({
      window: win,
      getTray: () => tray,
      settings,
      accounts,
      rooms: {
        mine: async () => {
          queries++;
          return [watchedRoom];
        },
        get: async () => {
          throw new Error("unexpected_query");
        },
        history: async () => ({ favorites: [] }),
        getPendingCount: () => 0,
      },
      isQuitting: () => false,
      trace: () => {},
    });
    registerRecordingClipIpc(settings, () => win);
    const js = (code) => win.webContents.executeJavaScript(code, true);
    const settle = () => js("new Promise(resolve => setTimeout(resolve, 200))");
    const fixture = path
      .join(__dirname, "fixtures/recording-clips-review.html")
      .replaceAll("\\", "/");
    await win.loadURL(`http://127.0.0.1:${process.env.CLIP_REVIEW_PORT || "45736"}/@fs/${fixture}`);
    await js(
      "new Promise((resolve, reject) => { const end = Date.now()+15000; const poll=()=>window.__clipReview?.ready ? resolve() : Date.now()>end ? reject(new Error('ui_not_ready')) : setTimeout(poll,50); poll(); })",
    );
    await settle();
    assert.equal(
      await js("document.querySelectorAll('.recording-clip-row').length"),
      recording.markers.length,
    );
    assert.ok(recording.markers.length > 0);
    await js(
      "new Promise((resolve,reject)=>{const end=Date.now()+5000;const poll=()=>{const audio=document.querySelector('audio');if(audio?.readyState>=1)resolve();else if(Date.now()>end)reject(new Error('audio_not_ready:'+JSON.stringify({error:audio?.error?.message,code:audio?.error?.code,ready:audio?.readyState,network:audio?.networkState,src:audio?.currentSrc?.slice(0,30)})));else setTimeout(poll,20);};poll();})",
    );
    await js(
      "[...document.querySelectorAll('.recording-clip-row button')].find(button=>button.textContent.includes('试听')).click()",
    );
    assert.deepEqual(await js("window.__clipReview.previews[0]"), [10_000, 38_000]);
    // Hidden media may defer loading past metadata until an explicit play.
    // Still require playable samples and a moving clock after clicking preview.
    await js("new Promise((resolve,reject)=>{const end=Date.now()+5000;const poll=()=>{const a=document.querySelector('audio');if(a.readyState>=2&&!a.paused&&a.currentTime>10)resolve();else if(Date.now()>end)reject(new Error('preview_playback_stalled'));else setTimeout(poll,20)};poll()})");
    await settle();
    assert.equal(await js("document.querySelector('audio').paused"), false);
    await js(
      "document.querySelector('audio').currentTime=38;document.querySelector('audio').dispatchEvent(new Event('timeupdate'))",
    );
    assert.equal(
      await js("document.querySelector('audio').paused&&window.__clipReview.wasPreview()"),
      true,
    );
    await js("window.__clipReview.resetPreview()");
    assert.equal(await js("window.__clipReview.wasPreview()"), false);
    await js(
      "document.querySelector('.recording-clips-heading select').value='short';document.querySelector('.recording-clips-heading select').dispatchEvent(new Event('change',{bubbles:true}))",
    );
    await settle();
    assert.equal(config.recordingClipBeforeMs, 10_000);
    assert.equal(config.recordingClipAfterMs, 5_000);
    await js(
      "[...document.querySelectorAll('.recording-clip-row button')].find(button=>button.textContent.includes('导出')).click()",
    );
    await settle();
    assert.equal(await js("document.querySelector('dialog').open"), true);
    await js(
      "document.querySelector('dialog input').click();[...document.querySelectorAll('dialog button')].find(button=>button.textContent.includes('确认')).click()",
    );
    await js(
      "new Promise((resolve,reject)=>{const end=Date.now()+10000;const poll=()=>document.querySelector('.recording-clip-result')?resolve():Date.now()>end?reject(new Error('export_not_finished')):setTimeout(poll,50);poll();})",
    );
    assert.equal(config.hasDismissedRecordingClipConsent, true);
    await js(
      "document.querySelector('.recording-clip-result button').click();document.querySelector('.recording-clip-result').dispatchEvent(new Event('dragstart',{bubbles:true,cancelable:true}))",
    );
    await settle();
    assert.ok(dragFile?.endsWith(".m4a"));
    assert.equal(dragFile, revealedFile);
    assert.equal(await js("document.querySelector('.recording-clip-consent').open"), false);
    await fs.mkdir(artifact, { recursive: true });
    await fs.writeFile(
      path.join(artifact, "recording-clips-review.png"),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js("window.__clipReview.enter()");
    await settle();
    assert.match(tooltip, /通话中.*录音中/);
    response = 2;
    await background.hide();
    assert.equal(hidden, 0);
    response = 1;
    config = { ...config, isSystemNotificationEnabled: true };
    await background.hide();
    assert.equal(hidden, 1);
    assert.equal(await js("window.__clipReview.leaves"), 0);
    assert.equal(notices, 1);
    assert.equal(config.hasSeenTrayNotice, true);
    response = 0;
    await background.hide();
    assert.equal(hidden, 2);
    assert.equal(await js("window.__clipReview.leaves"), 1);
    assert.doesNotMatch(tooltip, /通话中|录音中/);
    assert.equal(notices, 1);
    assert.equal(queries, 0);
    const disabledQueries = queries;
    assert.ok(menu.items.some((item) => item.label === "隐藏窗口"));
    config = { ...config, isFriendOnlineNotificationEnabled: true };
    await js("window.desktopApi.app.setBackgroundActivity({inRoom:false,isRecording:false})");
    await settle();
    assert.equal(queries, 1);
    assert.equal(notices, 1);
    watchedRoom.onlineCount = 1;
    await js("window.desktopApi.app.setBackgroundActivity({inRoom:false,isRecording:false})");
    await settle();
    assert.equal(notices, 2);
    assert.ok(menu.items.some((item) => item.label.includes("测试房间")));
    shownNotifications.at(-1).emit("click");
    await settle();
    assert.equal(await js("window.__clipReview.picks"), 1);
    assert.equal(await js("window.__clipReview.leaves"), 1);
    assert.doesNotMatch(tooltip, /通话中|录音中/);
    const attacker = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        preload: path.join(__dirname, "fixtures/recording-clips-preload.cjs"),
      },
    });
    await attacker.loadURL("data:text/html,<html></html>");
    const denied = await attacker.webContents.executeJavaScript(
      "window.desktopApi.recording.showClipInFolder('bad').then(()=>false,()=>true)",
      true,
    );
    assert.equal(denied, true);
    attacker.destroy();
    const report = {
      ok: true,
      isolatedProfile: true,
      realSandboxedExport: true,
      realAudioPreviewBoundary: true,
      presetPersisted: true,
      consentPersisted: true,
      firstTrayNoticeOnce: true,
      notificationClickOpensPreviewOnly: true,
      nativeDragBoundary: true,
      nativeRevealBoundary: true,
      closeCancel: true,
      continueCall: true,
      ownerCleanupBeforeHide: true,
      foreignRendererRejected: true,
      backgroundQueriesWhenDisabled: disabledQueries,
    };
    await fs.writeFile(
      path.join(artifact, "recording-clips-tray-review.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    background.dispose();
    tray.destroy();
    win.destroy();
    clearTimeout(deadline);
    app.quit();
  } catch (error) {
    console.error(error);
    await fs.mkdir(artifact, { recursive: true });
    await fs.writeFile(path.join(artifact, "recording-clips-tray-review-error.txt"), String(error));
    background?.dispose();
    tray?.destroy();
    win?.destroy();
    clearTimeout(deadline);
    app.exit(1);
  }
});
