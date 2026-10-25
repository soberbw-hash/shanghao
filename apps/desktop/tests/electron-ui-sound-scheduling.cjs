/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, process, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "ui-sound-scheduling");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 30_000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  view.webContents.setAudioMuted(true);
  try {
    const file = path.join(__dirname, "fixtures/room-entry-performance.html").replaceAll("\\", "/");
    const origin = process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173";
    await view.loadURL(`${origin}/@fs/${file}`);
    const result = await view.webContents.executeJavaScript(
      `(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let i=0;i<100&&!window.performanceFixture;i++) await pause(30);
      const fixture = window.performanceFixture;
      await fixture.unlockUiSounds();
      const sounds = [];
      const sources = [];
      const nativeStart = AudioBufferSourceNode.prototype.start;
      const nativeCreateBuffer = AudioContext.prototype.createBuffer;
      let allocatedBuffers=0;
      AudioContext.prototype.createBuffer=function(...args) { allocatedBuffers++; return nativeCreateBuffer.apply(this,args); };
      AudioBufferSourceNode.prototype.start = function (...args) {
        sources.push({duration:this.buffer?.duration,startedAt:performance.now(),audioTime:this.context.currentTime});
        return nativeStart.apply(this,args);
      };
      for (const cue of ['button-click','member-join','record-start','enter-room']) {
        const allocatedBefore=allocatedBuffers;
        const startedAt = performance.now(); fixture.playUiSound(cue);
        sounds.push({cue,synchronousMs:performance.now()-startedAt,synchronousBuffers:allocatedBuffers-allocatedBefore}); await pause(80);
      }
      await pause(400);
      const entryStart=performance.now(); fixture.playUiSound('enter-room');
      await pause(10); fixture.playUiSound('member-join'); await pause(50);
      const entryOverlap=sources.filter(source=>source.startedAt>=entryStart);
      await pause(700);
      const beforeLater=sources.length;
      fixture.playUiSound('member-join'); await pause(30);
      const laterMemberPlayed=sources.length===beforeLater+1;
      fixture.stopAllUiSounds(); await pause(250);
      const beforeCancelled=sources.length;
      fixture.playUiSound('member-join'); fixture.cancelDelayedRoomEntryCue(); await pause(30);
      const cancelledSilent=sources.length===beforeCancelled;
      await pause(250);
      fixture.playUiSound('member-join'); fixture.setUiSoundFeedbackEnabled(false); await pause(30);
      const disabledSilent=sources.length===beforeCancelled;
      const context=new AudioContext();
      const {buffer}=await fixture.loadRoomMemberJoinCue(context);
      const expected=fixture.renderRecipe(fixture.createRecipe('organic','connect'),context.sampleRate);
      const exactSamples=[expected.left,expected.right].every((samples,channel)=>{
        const actual=buffer.getChannelData(channel);
        return actual.length===samples.length&&actual.every((sample,index)=>sample===samples[index]);
      });
      await context.close();
      AudioBufferSourceNode.prototype.start=nativeStart;
      AudioContext.prototype.createBuffer=nativeCreateBuffer;
      return {sounds,sources,entryOverlap,laterMemberPlayed,cancelledSilent,disabledSilent,exactSamples};
    })()`,
      true,
    );
    console.log(JSON.stringify(result));
    if (result.sounds.find((sound) => sound.cue === "member-join").synchronousBuffers !== 0)
      throw Error("cold member join still synthesizes on the renderer");
    if (result.entryOverlap.length !== 1)
      throw Error("member snapshot stacks a second cue on local room entry");
    if (
      !result.laterMemberPlayed ||
      !result.cancelledSilent ||
      !result.disabledSilent ||
      !result.exactSamples
    )
      throw Error(
        "member cue changed samples, lost later joins, or survived cancellation/feedback disable",
      );
    await view.loadURL(`${origin}/@fs/${file}`);
    const delayed = await view.webContents.executeJavaScript(
      `(async () => {
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      for(let i=0;i<100&&!window.performanceFixture;i++) await pause(30);
      const NativeWorker=Worker;
      let terminated=0,starts=0;
      window.Worker=class extends NativeWorker {
        set onmessage(listener) { super.onmessage=event=>setTimeout(()=>listener(event),300); }
        terminate() { terminated++; super.terminate(); }
      };
      const nativeStart=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args) { starts++; return nativeStart.apply(this,args); };
      await window.performanceFixture.unlockUiSounds();
      window.performanceFixture.playUiSound('member-join'); await pause(550);
      const staleSilent=starts===0;
      window.performanceFixture.playUiSound('member-join'); await pause(30);
      const freshRetryPlayed=starts===1;
      window.Worker=NativeWorker; AudioBufferSourceNode.prototype.start=nativeStart;
      return {staleSilent,freshRetryPlayed,terminated};
    })()`,
      true,
    );
    console.log(JSON.stringify({ delayedWorker: delayed }));
    if (!delayed.staleSilent || !delayed.freshRetryPlayed || delayed.terminated !== 1)
      throw Error("late worker cue played stale audio or failed to retain its reusable buffer");
    await view.loadURL(`${origin}/@fs/${file}`);
    const resumeCancelled = await view.webContents.executeJavaScript(
      `(async () => {
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      for(let i=0;i<100&&!window.performanceFixture;i++) await pause(30);
      const NativeContext=AudioContext;
      let context,starts=0,release;
      window.AudioContext=class extends NativeContext { constructor(...args) { super(...args); context=this; } };
      const fixture=window.performanceFixture;
      await fixture.unlockUiSounds(); await context.suspend();
      const nativeResume=context.resume.bind(context);
      context.resume=()=>new Promise(resolve=>{ release=()=>nativeResume().then(resolve); });
      const nativeStart=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args) { starts++; return nativeStart.apply(this,args); };
      fixture.playUiSound('member-join'); fixture.cancelDelayedRoomEntryCue();
      await release(); await pause(150);
      window.AudioContext=NativeContext; AudioBufferSourceNode.prototype.start=nativeStart;
      return starts===0;
    })()`,
      true,
    );
    console.log(JSON.stringify({ suspendedContextCancelled: resumeCancelled }));
    if (!resumeCancelled) throw Error("cancelled member cue survived a delayed context resume");
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
