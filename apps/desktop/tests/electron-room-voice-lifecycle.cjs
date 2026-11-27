/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "room-voice-lifecycle");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const timeout = setTimeout(() => app.exit(1), 30000);

app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 1120,
    height: 760,
    show: false,
    webPreferences: { backgroundThrottling: false, offscreen: true },
  });
  view.webContents.setAudioMuted(true);
  view.webContents.on("console-message", (event) => {
    if (event.level === "error") console.error(event.message);
  });
  let exitCode = 0;
  try {
    const fixture = path
      .join(__dirname, "fixtures/room-voice-lifecycle.html")
      .replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5193"}/@fs/${fixture}`,
    );
    const result = await view.webContents.executeJavaScript(
      `(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const until = async (read, message) => {
        for (let step = 0; step < 120; step++) {
          const result = read();
          if (result) return result;
          await pause(20);
        }
        throw new Error(message + ': ' + JSON.stringify(window.roomVoiceFixture?.state()) + ' ' + document.body.innerText.slice(0, 400));
      };
      const button = (label) => [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
      const fixture = await until(() => window.roomVoiceFixture, 'fixture not ready');
      const join = () => document.querySelector('[aria-label="进入房间：测试语音房"]');
      await until(join, 'directory did not render');
      document.querySelector('.private-room-browser strong').click();
      await pause(120);
      check(!fixture.state().wireJoined && fixture.state().micRequests === 0, 'selecting a room started its connection or microphone');
      const searchStarted = performance.now();
      button('查找').click();
      await until(() => document.querySelector('dialog[open]'), 'search dialog failed to open');
      const searchVisibleMs = performance.now() - searchStarted;
      document.querySelector('[aria-label="关闭房间查找"]').click();
      await until(() => !document.querySelector('dialog[open]'), 'search dialog failed to close');
      check(fixture.state().micRequests === 0, 'search dialog opened the microphone');

      const longTasks = [];
      const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((entry) => entry.duration)));
      observer.observe({ type: 'longtask' });
      const joinStarted = performance.now();
      join().click();
      await until(() => join()?.disabled, 'join button did not immediately provide feedback');
      const joinFeedbackMs = performance.now() - joinStarted;
      await until(() => fixture.state().wireJoined, 'join was not sent');
      fixture.snapshot();
      await pause(60);
      check(fixture.state().page === 'home' && fixture.state().micRequests === 0, 'room snapshot without join acknowledgement admitted the microphone');
      fixture.ack();
      await until(() => fixture.state().connection === 'waiting_snapshot', 'acknowledgement was not applied');
      fixture.remote();
      await pause(300);
      const pending = fixture.state();
      check(pending.page === 'home' && pending.micRequests === 0 && !pending.inputEnabled, 'join acknowledgement opened microphone before admission');
      check(pending.webrtcCount === 0 && pending.relayCount === 0, 'audio from the joining room played before admission');
      const snapshotStarted = performance.now();
      fixture.snapshot();
      await until(() => button('退出房间'), 'accepted room did not appear');
      const snapshotToRoomMs = performance.now() - snapshotStarted;
      await until(() => fixture.state().inputEnabled, 'confirmed room did not open microphone');
      check(fixture.state().micRequests === 1, 'entering used duplicate microphone capture');
      fixture.remote();
      await until(() => fixture.state().webrtcCount === 1 && fixture.state().relayCount === 1, 'admitted room audio paths did not attach');
      const leaveStarted = performance.now();
      button('退出房间').click();
      check(!fixture.state().inputEnabled && fixture.state().webrtcCount === 0 && fixture.state().relayCount === 0, 'leave did not immediately disconnect audible media');
      await until(join, 'room list waited for the slow network close');
      const leaveToRoomListMs = performance.now() - leaveStarted;
      await until(() => fixture.state().closing, 'network cleanup was not called');
      check(join().disabled && !fixture.state().rawLive, 'room list enabled rejoin early or retained the microphone');
      check(document.querySelector('.private-room-browser [role=status]')?.textContent.includes('正在结束上一房间'), 'slow disconnect displayed the wrong feedback');
      fixture.remote();
      check(fixture.state().relayCount === 0, 'late relay audio recreated playback after leave');
      fixture.finishClose();
      await until(() => join() && !join().disabled, 'room list stayed busy after teardown');

      fixture.denyMicrophone();
      join().click();
      await until(() => fixture.state().wireJoined, 'second join was not sent');
      fixture.ack();
      fixture.snapshot();
      await until(() => button('退出房间') && fixture.state().micRequests === 2, 'a denied microphone prevented listen-only entry');
      check(!fixture.state().inputEnabled && !fixture.state().rawLive, 'denied microphone enabled a capture');
      observer.disconnect();
      return { searchVisibleMs, joinFeedbackMs, snapshotToRoomMs, leaveToRoomListMs, longTasks };
    })()`,
      true,
    );
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
    view.destroy();
    app.exit(exitCode);
  }
});
