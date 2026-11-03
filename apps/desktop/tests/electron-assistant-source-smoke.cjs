/* global require, process, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "assistant-source");
app.disableHardwareAcceleration();
const deadline = setTimeout(() => app.exit(1), 35_000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 1200,
    height: 850,
    show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  view.webContents.setAudioMuted(true);
  view.webContents.on("console-message", (event) => {
    if (event.message.includes("Error")) process.stderr.write(event.message + "\n");
  });
  try {
    const file = path.resolve("tests/visual/assistant-source.html").replaceAll("\\", "/");
    await view.loadURL(`http://127.0.0.1:5174/@fs/${file}`);
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const wait=ms=>new Promise(r=>setTimeout(r,ms)),check=(ok,why)=>{if(!ok)throw Error(why)};
      for(let i=0;i<100&&!document.querySelector('.room-ai-composer input');i++)await wait(50);
      await wait(300);
      const bubble=document.querySelector('.chat-message-bubble.is-assistant');
      check(bubble,'assistant presentation missing');
      const style=getComputedStyle(bubble),tail=getComputedStyle(bubble,'::before');
      check(parseFloat(style.borderTopLeftRadius)<parseFloat(style.borderBottomLeftRadius),'assistant points to next speaker');
      check(tail.content!=='none'&&parseFloat(tail.left)<0&&parseFloat(tail.top)<=0,'tail is not next to own avatar');
      const input=document.querySelector('.room-ai-composer input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'约好几点集合？');
      input.dispatchEvent(new Event('input',{bubbles:true}));await wait(50);
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
      for(let i=0;i<100&&!document.querySelector('[aria-label="发送相关记录到聊天"]');i++)await wait(30);
      check(!document.querySelector('.room-ai-answer').textContent.includes('不应显示的频道名'),'channel name is still shown');
      check(!document.querySelector('.room-ai-answer').textContent.includes('其他频道不可见'),'foreign source leaked');
      check(document.querySelector('.room-ai-answer').textContent.includes('2026年10月31日 22:05'),'source wall-clock time missing');
      document.querySelector('[aria-label="发送相关记录到聊天"]').click();await wait(150);
      const messages=document.querySelectorAll('.chat-message-bubble');
      const shared=[...messages].find(b=>b.textContent.includes('相关记录'));
      check(shared&&shared.textContent.includes('2026年10月31日 22:05')&&!shared.textContent.includes('不应显示的频道名'),'shared date incorrect');
      window.sourceFixture.switchRoom();await wait(80);
      document.querySelector('[aria-label="发送相关记录到聊天"]').click();await wait(100);
      check(document.querySelectorAll('.chat-message-bubble').length===messages.length,'stale panel sent into new channel');
      return {ok:true,assistantTail:true,fullSourceDate:true,noRoomName:true,foreignSourcesHidden:true,staleShareBlocked:true};
    })().catch(e=>{console.error(e.stack);throw e})`);
    await fs.writeFile(
      path.resolve("../../artifacts/assistant-source-20261031.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
    process.stdout.write(JSON.stringify(result) + "\n");
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    process.stderr.write(String(error) + "\n");
    clearTimeout(deadline);
    app.exit(1);
  }
});
