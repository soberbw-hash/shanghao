/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "settings-hierarchy");
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ width: 1280, height: 900, show: false });
  const evaluate = (source) => view.webContents.executeJavaScript(source, true);
  const key = (keyCode) => {
    view.webContents.sendInputEvent({ type: "keyDown", keyCode });
    view.webContents.sendInputEvent({ type: "char", keyCode: keyCode === "Enter" ? "\r" : " " });
    view.webContents.sendInputEvent({ type: "keyUp", keyCode });
  };
  try {
    const fixture = path.join(__dirname, "fixtures/private-room-ui.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${fixture}`,
    );
    view.show();
    view.focus();
    view.webContents.focus();
    await evaluate(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));const check=(v,m)=>{if(!v)throw Error(m)};
      for(let i=0;i<100&&!document.querySelector('.private-room-featured');i++)await pause(40);
      const featured=document.querySelector('.private-room-featured');
      check(featured,'last room did not render');
      check(featured.querySelectorAll('button').length===2,'featured room still has a duplicate join action');
      check(featured.textContent.includes('今晚一起上号')&&featured.textContent.includes('2/5 在线'),'featured room identity or presence missing');
      check(document.querySelector('[data-testid="joined"]').textContent.includes('尚未加入'),'viewing the room implicitly joined it');
      const favorite=featured.querySelector('[aria-label="收藏房间"]');favorite.click();await pause(60);
      check(featured.querySelector('[aria-label="取消收藏房间"]'),'favorite action did not persist in fixture');
      check(document.querySelector('[data-testid="joined"]').textContent.includes('尚未加入'),'favoriting implicitly joined the room');
      const nav=document.querySelector('nav[aria-label="设置栏目"]');
      check(nav.querySelector('[role="group"][aria-label="常用"]'),'common settings group missing');
      check(nav.querySelector('[role="group"][aria-label="进阶与支持"]'),'advanced settings group missing');
      check(nav.querySelectorAll('button').length===8,'a settings destination disappeared');
      featured.querySelector('button:not([aria-label])').focus();
    })()`);
    await evaluate(
      `(()=>{const button=document.querySelector('.private-room-featured button:not([aria-label])');button.focus();if(document.activeElement!==button)throw Error('join button did not acquire keyboard focus')})()`,
    );
    key("Enter");
    await evaluate(`(async()=>{
      await new Promise(r=>setTimeout(r,80));
      if(!document.querySelector('[data-testid="joined"]').textContent.includes('已明确加入 000021'))throw Error('Enter did not join the last room');
      const button=[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent==='诊断');
      button.focus();
    })()`);
    key("Space");
    await evaluate(`(async()=>{
      await new Promise(r=>setTimeout(r,80));
      const current=document.querySelector('.settings-nav [aria-current="page"]');
      if(current?.textContent!=='诊断'||document.querySelectorAll('.settings-nav [aria-current="page"]').length!==1)throw Error('Space did not select advanced navigation');
    })()`);
    console.log(
      JSON.stringify({
        singleJoinAction: true,
        keyboardJoin: true,
        favoriteIndependent: true,
        groupedNavigation: true,
        keyboardNavigation: true,
      }),
    );
    clearTimeout(timeout);
    view.destroy();
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
