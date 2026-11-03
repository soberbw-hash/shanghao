/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, process, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const fs = require("node:fs/promises"), path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "member-availability");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 820,
    height: 640,
    show: false,
    title: "上号 · 成员状态检查",
    webPreferences: { backgroundThrottling: false, offscreen: true },
  });
  view.webContents.setAudioMuted(true);
  try {
    const file = path.join(__dirname, "visual/member-availability.html").replaceAll("\\", "/");
    if (process.env.SHANGHAO_STATIC_UI === "1") await view.loadFile(path.resolve(__dirname, "../../../artifacts/native-ui/member-status.static.html"));
    else await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}`,
    );
    const result = await view.webContents.executeJavaScript(
      `(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));
      for(let i=0;i<80&&!document.querySelector('.member-availability-controls');i++)await pause(50);
      await pause(2000);
      const check=(ok,message)=>{if(!ok)throw Error(message)};
      const characters=()=>[...document.querySelectorAll('.scene-character-motion')];
      check(characters().length===3,'member count mismatch');
      check(getComputedStyle(document.querySelector('.chat-panel-title')).userSelect==='none','chat title can be selected and dragged');
      check(characters().every(el=>Number(getComputedStyle(el).opacity)>.4),'hidden member');
      document.querySelector('.member-availability-controls button:nth-child(3)').click(); await pause(2000);
      check(document.querySelector('#fixture-muted').textContent==='muted','status failed to mute');
      check(document.querySelector('.scene-availability-bubble')?.textContent.includes('吃饭中'),'missing persistent status');
      check(document.querySelector('.scene-availability-bubble').getBoundingClientRect().height>=24,'away status text was scaled too small');
      document.querySelector('#fixture-rerender').click();await pause(100);
      check(document.querySelector('.scene-availability-bubble')?.textContent.includes('吃饭中'),'snapshot erased status');
      for(const [label,index] of [['暂时离开',0],['去厕所',3],['吃饭中',2]]) {
        document.querySelectorAll('.member-availability-controls button')[index].click();await pause(150);
        check(characters()[0].querySelector('[data-scene-zone]').dataset.sceneZone==='gameDesk1','status moved character away from seat');
        check(document.querySelector('.scene-availability-bubble')?.textContent.includes(label),'wrong status label');
        check(document.querySelector('#fixture-muted').textContent==='muted','switching status opened microphone');
      }
      const statusButtons=[...document.querySelectorAll('.member-availability-controls button')];
      check(statusButtons.map(button=>button.textContent.trim()).join('|')==='离开|电话|吃饭|厕所','phone button order');
      statusButtons[1].click();await pause(220);
      check(window.phoneFixture.calls.length===1&&window.phoneFixture.calls[0]===true,'mouse entry must be one toggle');
      check(document.querySelector('.scene-availability-bubble')?.textContent.includes('通话中'),'phone bubble missing');
      check(!document.querySelector('.scene-availability-bubble')?.textContent.includes('吃饭'),'phone and eating shown together');
      check(characters()[0].querySelector('.room-character-state-text')?.textContent==='通话中','phone label mismatch');
      check([0,2,3].every(index=>!statusButtons[index].disabled),'phone mode locked the other choices');
      statusButtons[1].click();await pause(220);
      check(window.phoneFixture.calls.length===2&&window.phoneFixture.calls[1]===false,'mouse exit must be toggle');
      check(!document.querySelector('.scene-availability-bubble'),'mouse phone cancellation resurrected an old status');
      check(document.querySelector('#fixture-muted').textContent==='open','phone cancellation lost original microphone choice');
      statusButtons[2].click();await pause(100);
      window.phoneFixture.emit(true);await pause(80);window.phoneFixture.emit(false);await pause(80);
      check(document.querySelector('.scene-availability-bubble')?.textContent.includes('吃饭中'),'keyboard exit lost status');
      check(window.phoneFixture.configureCalls===0,'mouse toggle changed keyboard preferences');
      statusButtons[2].click(); await pause(200);
      check(document.querySelector('#fixture-muted').textContent==='open','return did not restore previous mute choice');
      check(!document.querySelector('.scene-availability-bubble'),'status not cleared');
      check(characters().length===3&&characters().every(el=>Number(getComputedStyle(el).opacity)>.4),'member lost after movement');
      check(characters()[0].querySelector('[data-scene-zone]').dataset.sceneZone==='gameDesk1','clearing status changed seat');
      document.dispatchEvent(new Event('fixture-hold-network'));
      const labels=['暂时离开','通话中','吃饭中','去厕所'];
      const click=async index=>{statusButtons[index].click();await pause(220)};
      for(let first=0;first<4;first++)for(let second=0;second<4;second++){
        if(first===second)continue;
        await click(first);await click(second);
        check(document.querySelector('.member-availability-controls').dataset.status===['away','phone','eating','restroom'][second],'cross-status selection failed');
        check(document.querySelectorAll('.scene-availability-bubble').length===1,'status bubbles overlap or disappear');
        check(document.querySelector('.scene-availability-bubble').textContent.includes(labels[second]),'character bubble differs from selected status');
        const state=window.availabilityFixture.audio();
        check(state.isMuted&&!state.trackEnabled,'switch opened the send track');
        check(state.isDeafened===(second===0||second===1),'wrong speaker state');
        await click(second);
        check(!document.querySelector('.scene-availability-bubble'),'second click did not clear bubble');
        check(!window.availabilityFixture.audio().isMuted&&window.availabilityFixture.audio().trackEnabled,'cancel did not restore send track');
      }
      statusButtons[1].click();statusButtons[2].click();statusButtons[0].click();statusButtons[3].click();await pause(350);
      check(document.querySelector('.scene-availability-bubble')?.textContent.includes('去厕所'),'rapid pending phone switch ignored the last choice');
      await click(3);await click(1);
      window.phoneFixture.failNext=true;await click(2);
      check(document.querySelector('.scene-availability-bubble')?.textContent.includes('通话中'),'failed phone exit claimed a new state');
      check(!window.availabilityFixture.audio().trackEnabled,'failed exit opened the microphone');
      await click(2);await click(2);
      check(!document.querySelector('.scene-availability-bubble'),'recovered cancellation left a stale bubble');
      return {passed:true,members:characters().length,persistentStatus:true,allTwelveDirectTransitions:true,singleBubble:true,slowNetworkDoesNotLock:true,rapidLastChoiceWins:true,nativeFailureKeepsMuted:true,restoredMicrophone:true,mousePhoneToggle:true,keyboardPreferencesUnchanged:true,exclusivePhoneDisplay:true};
    })()`,
      true,
    );
    await fs.writeFile(
      path.resolve(__dirname, "../../../artifacts/member-status-switch-20261101.json"),
      JSON.stringify(result, null, 2),
    );
    await view.webContents.executeJavaScript(
      `document.querySelector('.member-availability-controls button:nth-child(3)').click();new Promise(resolve=>setTimeout(resolve,1600))`,
      true,
    );
    await fs.writeFile(
      path.resolve(__dirname, "../../../artifacts/member-status-switch-20261101.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
    console.log(JSON.stringify(result));
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
