/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, process, setTimeout, clearTimeout */
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
    const releaseDirectory =
      process.env.SHANGHAO_RELEASE_CAPTURE === "1"
        ? path.resolve(
            __dirname,
            "../../../docs/assets/releases",
            `v${require("../package.json").version}`,
          )
        : undefined;
    if (releaseDirectory) await fs.mkdir(releaseDirectory, { recursive: true });
    await view.loadFile(path.join(output, "tests/fixtures/temporary-entry.html"));
    const evaluate = (script) => view.webContents.executeJavaScript(script);
    await evaluate(
      `(async()=>{for(let i=0;i<100;i++){const trigger=document.querySelector('.temporary-entry-trigger');if(trigger){if(document.querySelector('.temporary-entry input'))throw Error('entry leaked into login');trigger.click();return;}await new Promise(r=>setTimeout(r,30));}throw Error('entry missing');})()`,
    );
    await evaluate(`(async () => {
      for(let i=0;i<100;i++) {
        if(document.querySelector('.temporary-entry input')?.value==='临时朋友' && document.querySelector('dialog:modal')) return;
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
    if (releaseDirectory) {
      view.setContentSize(700, 650);
      await fs.writeFile(
        path.join(releaseDirectory, "temporary-entry.png"),
        (await view.webContents.capturePage()).toPNG(),
      );
    }
    await evaluate(`document.querySelector('[aria-label="选择蜜桃狐"]').click()`);
    const result = await evaluate(`(async () => {
      const wait=async fn=>{for(let i=0;i<150;i++){if(fn())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('fixture timeout');};
      await wait(()=>window.temporaryEntryEvidence.prepared===1);
      const create=[...document.querySelectorAll('button')].find(button=>button.textContent==='创建临时房间');
      await wait(()=>!create.disabled);create.click();
      await wait(()=>window.temporaryEntryEvidence.created===1);
      await wait(()=>!create.disabled);
      [...document.querySelectorAll('button')].find(button=>button.textContent==='加入房间').click();
      await wait(()=>document.querySelector('.temporary-join-action'));
      const input=document.querySelector('[aria-label="加入已有房间的八位房间码"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0012 3456');input.dispatchEvent(new Event('input',{bubbles:true}));
      await wait(()=>input.value==='00123456');document.querySelector('form').requestSubmit();
      await wait(()=>window.temporaryEntryEvidence.joined);
      const data=window.temporaryEntryEvidence;
      if(data.createdArgs.length||data.joined!=='00123456')throw Error('create/join code confusion');
      if(data.saved.avatarId!=='fox'||!data.saved.avatarDataUrl.startsWith('data:image/png;base64,'))throw Error('portrait not saved compatibly');
      return {createdArgs:data.createdArgs,joined:data.joined,avatarId:data.saved.avatarId,avatarPNG:true};
    })()`);
    const screenshot = path.join(output, "temporary-entry-360.png");
    view.setContentSize(360, 650);
    await fs.writeFile(screenshot, (await view.webContents.capturePage()).toPNG());
    if (releaseDirectory)
      await fs.copyFile(screenshot, path.join(releaseDirectory, "temporary-join.png"));
    await view.loadFile(path.join(output, "tests/fixtures/temporary-entry.html"), {
      search: "?signed=1",
    });
    await evaluate(
      `(async()=>{for(let i=0;i<100;i++){const trigger=document.querySelector('.temporary-entry-trigger');if(trigger){trigger.click();break;}await new Promise(r=>setTimeout(r,30));}for(let i=0;i<100;i++){if(document.querySelector('.temporary-entry input')?.value==='账号朋友'&&document.querySelector('[alt="自定义临时头像"]')){document.querySelector('[aria-label="关闭临时联机"]').click();await new Promise(r=>setTimeout(r,30));document.querySelector('.temporary-entry-trigger').click();await new Promise(r=>setTimeout(r,30));if(!document.querySelector('dialog:modal'))throw Error('repeat open failed');return;}await new Promise(resolve=>setTimeout(resolve,30));}throw Error('signed identity not inherited');})()`,
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
