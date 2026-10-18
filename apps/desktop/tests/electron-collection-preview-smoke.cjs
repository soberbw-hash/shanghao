/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, process, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "collection-preview");
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 900,
    height: 850,
    webPreferences: { backgroundThrottling: false },
  });
  try {
    const file = path.join(__dirname, "visual/collection-preview.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}`,
    );
    const result = await view.webContents.executeJavaScript(
      `(async()=>{
      const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const check=(ok,msg)=>{if(!ok)throw Error(msg)};
      for(let i=0;i<80&&!document.querySelector('.collection-link-art img')?.naturalWidth;i++)await pause(50);
      await pause(300);
      const cards=[...document.querySelectorAll('.collection-item')];
      check(cards.length===4,'existing favorites lost');
      check(cards[0].querySelector('strong').textContent.includes('英雄联盟'),'metadata title missing');
      check(cards[0].textContent.includes('阵容思路'),'description missing');
      check(cards[0].textContent.includes('游戏资料站'),'site identity missing');
      check(cards[0].querySelector('img').naturalWidth>0,'cover did not load');
      check(cards[1].textContent.includes('稍后再看的链接'),'offline fallback lost saved title');
      check(cards[1].querySelector('.collection-link-art svg'),'offline fallback icon missing');
      check(cards[2].querySelector('.collection-link-art svg'),'broken image did not fall back');
      cards[0].querySelector('.collection-link-preview').click();await pause(50);
      check(document.querySelector('#fixture-event').textContent==='open:https://example.com/game-guide','open target changed');
      cards[0].querySelector('[title="复制"]').click();await pause(50);
      check(document.querySelector('#fixture-event').textContent==='copy:https://example.com/game-guide','copy target changed');
      check(cards.every(el=>el.scrollWidth<=el.clientWidth+1),'card content overflows');
      return {passed:true,cover:true,description:true,offlineFallback:true,brokenImageFallback:true,actions:true};
    })()`,
      true,
    );
    await fs.writeFile(
      path.join(os.tmpdir(), "shanghao-collection-preview.png"),
      (await view.webContents.capturePage()).toPNG(),
    );
    view.setSize(540, 780);
    await new Promise((resolve) => setTimeout(resolve, 250));
    await view.webContents.executeJavaScript(
      `(async()=>{
      if(document.documentElement.scrollWidth>innerWidth+1)throw Error('narrow layout overflow');
      const first=document.querySelector('.collection-item');first.querySelector('[title="删除"]').click();
      await new Promise(resolve=>setTimeout(resolve,50));
      if(document.querySelectorAll('.collection-item').length!==3)throw Error('delete failed');
      document.querySelector('.collection-modal-header button').click();
      await new Promise(resolve=>setTimeout(resolve,300));
      if(document.querySelector('[role="dialog"]'))throw Error('close failed');
    })()`,
      true,
    );
    console.log(JSON.stringify({ ...result, narrowLayout: true, deleteAndClose: true }));
    clearTimeout(deadline);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
