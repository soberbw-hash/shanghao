/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const { tmpdir } = require("node:os");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "temporary-entry");
const deadline = setTimeout(() => app.exit(1), 30_000);
app.whenReady().then(async () => {
  let view;
  try {
    const { build } = await import("vite"),
      { default: react } = await import("@vitejs/plugin-react-swc");
    const output = await fs.mkdtemp(path.join(tmpdir(), "shanghao-temporary-entry-"));
    await build({
      configFile: false,
      base: "./",
      root: path.join(__dirname, ".."),
      plugins: [react()],
      resolve: {
        alias: {
          "@private-voice/shared": path.join(__dirname, "../../../packages/shared/src/index.ts"),
        },
      },
      build: {
        outDir: output,
        target: "esnext",
        rollupOptions: { input: path.join(__dirname, "fixtures/temporary-entry.html") },
      },
    });
    view = new BrowserWindow({
      show: false,
      width: 420,
      height: 650,
      webPreferences: { backgroundThrottling: false },
    });
    view.webContents.setAudioMuted(true);
    await view.loadFile(path.join(output, "tests/fixtures/temporary-entry.html"));
    const evaluate = (script) => view.webContents.executeJavaScript(script);
    await evaluate(`(async () => {
      for(let i=0;i<100;i++) {
        if(document.querySelector('.temporary-entry input')?.value==='临时朋友') { document.querySelector('.temporary-entry').open=true;return; }
        await new Promise(resolve=>setTimeout(resolve,30));
      } throw Error('profile not restored');
    })()`);
    const layout = [];
    for (const width of [360, 420, 600]) {
      view.setContentSize(width, 650);
      await evaluate(
        `(async()=>{for(let i=0;i<100;i++){if(innerWidth===${width})return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('resize not applied');})()`,
      );
      const result = await evaluate(`(() => {
        const row=document.querySelector('.temporary-avatar-picker');
        const upload=row.querySelector('.temporary-avatar-upload').getBoundingClientRect();
        const icons=[...row.querySelectorAll('button')];
        const rect=row.getBoundingClientRect();
        const overflow=document.documentElement.scrollWidth>innerWidth;
        const rows=new Set(icons.map(icon=>Math.round(icon.getBoundingClientRect().top)));
        const svgOnly=icons.every(icon=>{const src=icon.querySelector('img').src;return src.includes('.svg')||src.startsWith('data:image/svg+xml');});
        return {width:innerWidth,overflow,singleRow:rows.size===1,svgOnly,uploadAtEnd:upload.right<=rect.right+1&&upload.left>rect.left};
      })()`);
      if (result.overflow || !result.singleRow || !result.svgOnly || !result.uploadAtEnd)
        throw Error(JSON.stringify(result));
      layout.push(result);
    }
    await evaluate(`document.querySelector('[aria-label="加入已有房间的八位房间码"]').focus()`);
    await view.webContents.insertText("0012 3456");
    await evaluate(`document.querySelector('[aria-label="选择蜜桃狐"]').click()`);
    const result = await evaluate(`(async () => {
      const wait=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('fixture timeout');};
      await wait(()=>window.temporaryEntryEvidence.prepared===1);
      const create=[...document.querySelectorAll('button')].find(button=>button.textContent==='创建临时房间');
      await wait(()=>!create.disabled);create.click();
      await wait(()=>window.temporaryEntryEvidence.created===1);
      await wait(()=>!create.disabled);
      [...document.querySelectorAll('button')].find(button=>button.textContent==='加入房间').click();
      await wait(()=>window.temporaryEntryEvidence.joined);
      await wait(()=>!create.disabled);
      const data=window.temporaryEntryEvidence;
      if(data.createdArgs.length||data.joined!=='00123456')throw Error('create/join code confusion');
      if(data.saved.avatarId!=='fox'||!data.saved.avatarDataUrl.startsWith('data:image/png;base64,'))throw Error('portrait not saved compatibly');
      return {createdArgs:data.createdArgs,joined:data.joined,avatarId:data.saved.avatarId,avatarPNG:true};
    })()`);
    const screenshot = path.join(output, "temporary-entry-360.png");
    view.setContentSize(360, 650);
    await fs.writeFile(screenshot, (await view.webContents.capturePage()).toPNG());
    await view.loadFile(path.join(output, "tests/fixtures/temporary-entry.html"), {
      search: "?signed=1",
    });
    await evaluate(
      `(async()=>{for(let i=0;i<100;i++){if(document.querySelector('.temporary-entry input')?.value==='账号朋友'&&document.querySelector('[alt="自定义临时头像"]'))return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error('signed identity not inherited');})()`,
    );
    console.log(JSON.stringify({ layout, ...result, signedIdentityInherited: true, screenshot }));
    clearTimeout(deadline);
    view.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    view?.destroy();
    app.exit(1);
  }
});
