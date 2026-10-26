/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow, nativeImage } = require("electron");
const { Buffer } = require("node:buffer");
const path = require("node:path"),
  fs = require("node:fs/promises");
const profile = require("./electron-isolated-profile.cjs").configureIsolatedProfile(
  app,
  "temporary-audio",
);
const nativeFixture = path.join(profile, "temporary-identity.cjs");
require(require.resolve("esbuild", { paths: [path.dirname(require.resolve("tsup"))] })).buildSync({
  entryPoints: [path.join(__dirname, "../src/main/temporary-identity-store.ts")],
  outfile: nativeFixture,
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
});
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    show: false,
    width: 1100,
    height: 900,
    webPreferences: { backgroundThrottling: false },
  });
  try {
    const normalize = require(nativeFixture).normalizeTemporaryAvatar;
    const source = nativeImage.createFromBitmap(Buffer.alloc(256 * 128 * 4, 255), {
      width: 256,
      height: 128,
    });
    const normalized = nativeImage.createFromDataURL(normalize(source.toDataURL())).getSize();
    if (normalized.width !== 128 || normalized.height !== 128)
      throw Error("avatar not cropped and resized");
    const noisy = nativeImage.createFromBitmap(require("node:crypto").randomBytes(128 * 128 * 4), {
      width: 128,
      height: 128,
    });
    if (normalize(noisy.toDataURL()).length > 32 * 1024)
      throw Error("avatar exceeds five-member snapshot budget");
    for (const invalid of [
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "data:image/png;base64," + "A".repeat(180001),
      null,
    ]) {
      let rejected = false;
      try {
        normalize(invalid);
      } catch {
        rejected = true;
      }
      if (!rejected) throw Error("invalid avatar decoded");
    }
    const file = path.join(__dirname, "fixtures/temporary-and-audio.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}`,
    );
    await view.webContents.executeJavaScript(
      `(async()=>{for(let i=0;i<150;i++){const trigger=document.querySelector('.temporary-entry-trigger');if(trigger){trigger.click();break;}await new Promise(r=>setTimeout(r,30));}for(let i=0;i<150;i++){const join=[...document.querySelectorAll('button')].find(b=>b.textContent==='加入房间');if(join){join.click();break;}await new Promise(r=>setTimeout(r,30));}for(let i=0;i<150;i++){const code=document.querySelector('[aria-label="加入已有房间的八位房间码"]');if(code){code.focus();return;}await new Promise(r=>setTimeout(r,30));}throw Error('room code input missing')})()`,
    );
    await view.webContents.insertText("0012 3456");
    const pastedCode = await view.webContents.executeJavaScript(
      `document.querySelector('[aria-label="加入已有房间的八位房间码"]').value`,
    );
    if (pastedCode !== "00123456") throw Error(`formatted room code truncated: ${pastedCode}`);
    const result = await view.webContents.executeJavaScript(`(async()=>{
      const wait=async (condition,label)=>{for(let i=0;i<150;i++){if(condition())return;await new Promise(r=>setTimeout(r,30));}throw Error(label);};
      await wait(()=>document.querySelector('.temporary-entry'),'fixture render');
      document.querySelector('.temporary-entry-back').click();
      await wait(()=>document.querySelector('.temporary-entry input').value==='临时朋友','profile');
      if(!document.querySelector('[alt="自定义临时头像"]'))throw Error('saved avatar not restored');
      if(window.fixtureState.joined)throw Error('profile restoration auto joined');
      const upload=document.querySelector('[aria-label="上传临时头像"]');
      const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array([137,80,78,71])],'synthetic.png',{type:'image/png'}));upload.files=transfer.files;upload.dispatchEvent(new Event('change',{bubbles:true}));
      await wait(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='创建临时房间')?.disabled,'avatar preparation must block joining');
      if(window.fixtureState.joined)throw Error('joining raced avatar normalization');
      await wait(()=>window.fixtureState.preparedAvatars===1,'avatar Main preparation');
      await wait(()=>document.querySelector('[alt="自定义临时头像"]'),'prepared preview');
      [...document.querySelectorAll('button')].find(b=>b.textContent==='创建临时房间').click();
      await wait(()=>window.fixtureState.joined,'guest create');
      document.querySelector('[aria-label="关闭临时联机"]').click();
      await wait(()=>document.querySelector('.temporary-management-trigger'),'management trigger');
      document.querySelector('.temporary-management-trigger').click();
      await wait(()=>document.querySelector('.temporary-management-dialog:modal'),'management top layer');
      const heading=document.querySelector('#temporary-management-title').getBoundingClientRect();
      if(!document.elementFromPoint(heading.x+10,heading.y+10)?.closest('dialog'))throw Error('management obscured');
      document.querySelector('[aria-label="关闭临时房间管理"]').click();
      if(!window.fixtureState.savedAvatar.startsWith('data:image/png;base64,'))throw Error('avatar lost at join');
      await wait(()=>document.querySelector('.temporary-room-network-note')?.textContent.includes('仅局域网可用'),'initial LAN-only warning');
      window.emitTemporaryState({contextId:'other-context',status:'connected'});
      await new Promise(r=>setTimeout(r,30));
      if(!document.querySelector('.temporary-room-network-note'))throw Error('foreign context cleared warning');
      window.emitTemporaryState({contextId:'fixture-context',status:'connected'});
      await wait(()=>!document.querySelector('.temporary-room-network-note'),'internet recovery clears warning');
      window.emitTemporaryState({contextId:'fixture-context',status:'connected',error:'temporary_internet_bridge_unavailable'});
      await wait(()=>document.querySelector('.temporary-room-network-note')?.textContent.includes('仅局域网可用'),'late LAN-only warning');
      [...document.querySelectorAll('button')].find(b=>b.textContent==='放歌').click();
      await wait(()=>document.querySelector('.application-audio-source'),'source list');
      document.querySelector('.application-audio-source').click();
      await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='开始放歌'&&!b.disabled),'start enabled');
      [...document.querySelectorAll('button')].find(b=>b.textContent==='开始放歌').click();
      await wait(()=>window.fixtureState.maximumRms>.04,'actual worklet PCM output');
      if(!document.body.textContent.includes('放歌中'))throw Error('sharing state');
      const state={...window.fixtureState,savedAvatar:!!window.fixtureState.savedAvatar};
      [...document.querySelectorAll('button')].find(b=>b.textContent==='放歌中').click();
      await wait(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='停止放歌'),'sharing controls');
      [...document.querySelectorAll('button')].find(b=>b.textContent==='停止放歌').click();
      await wait(()=>!window.fixtureState.attached&&window.fixtureState.stopped>0,'stopped and track released');
      const overflow=document.documentElement.scrollWidth>innerWidth;
      if(overflow)throw Error('horizontal overflow');
      return {...state,stopped:window.fixtureState.stopped,attachedAfterStop:window.fixtureState.attached,overflow};
    })()`);
    for (const query of ["signed=1", "signed=1&preset=1"]) {
      await view.loadURL(
        `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}?${query}`,
      );
      await view.webContents.executeJavaScript(
        `(async()=>{for(let i=0;i<150;i++){const trigger=document.querySelector('.temporary-entry-trigger');if(trigger){trigger.click();break;}await new Promise(r=>setTimeout(r,30));}for(let i=0;i<150;i++){if(document.querySelector('.temporary-entry input')?.value==='账号朋友'&&document.querySelector('[alt="自定义临时头像"]'))return;await new Promise(r=>setTimeout(r,30));}throw Error('signed-in identity not inherited')})()`,
      );
    }
    if (process.env.SHANGHAO_TEST_SCREENSHOT)
      await fs.writeFile(
        process.env.SHANGHAO_TEST_SCREENSHOT,
        (await view.webContents.capturePage()).toPNG(),
      );
    console.log(
      JSON.stringify({
        ...result,
        nativeAvatar128: true,
        invalidAvatarRejected: true,
        signedInProfileInherited: true,
      }),
    );
    clearTimeout(deadline);
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
