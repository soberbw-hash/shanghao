/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "diagnostics-guided");
const timeout = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  const view = new BrowserWindow({ width: 1120, height: 860, show: false });
  try {
    const fixture = path.join(__dirname, "fixtures/diagnostics-guided.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${fixture}`,
    );
    await view.webContents.executeJavaScript(`(async()=>{
      const pause=ms=>new Promise(r=>setTimeout(r,ms));const check=(v,m)=>{if(!v)throw Error(m)};
      for(let i=0;i<100&&!document.querySelector('.diagnostics-user-view');i++)await pause(30);
      const choices=document.querySelector('[aria-label="遇到了什么问题"]');
      check(choices,'guided troubleshooting choices missing');
      check(choices.querySelectorAll('button').length===5,'missing an ordinary-user troubleshooting path');
      const choiceButtons=[...choices.querySelectorAll('button')];
      choiceButtons.forEach((button,index)=>{const box=button.getBoundingClientRect();const content=button.querySelector('span').getBoundingClientRect();check(content.bottom<=box.bottom&&content.top>=box.top,'choice text overflows its button');if(index)check(choiceButtons[index-1].getBoundingClientRect().bottom<=box.top,'troubleshooting choices overlap')});
      check(!document.body.textContent.includes('系统状态 · 连接与设备'),'technical status grid still dominates the page');
      check(!document.body.textContent.includes('开发测试入口'),'development fault controls visible to ordinary users');
      check(!document.documentElement.dataset.action,'opening help unexpectedly probed AI hardware');
      const click=async(label,expected)=>{[...choices.querySelectorAll('button')].find(b=>b.textContent.includes(label)).click();await pause(40);const detail=document.querySelector('#diagnostics-guidance');check(detail,'selected guidance missing');const button=[...detail.querySelectorAll('button')].find(b=>b.dataset.action==='primary');check(button,'no next action for selected problem');button.click();check(document.documentElement.dataset.action===expected,'wrong troubleshooting destination');};
      await click('朋友听不到我','audio');await click('听不到朋友','audio');await click('进不去房间','home');await click('录音转不出文字','ai');await click('共享画面异常','room');
      [...document.querySelectorAll('button')].find(b=>b.textContent.includes('导出完整诊断包')).click();check(document.documentElement.dataset.action==='export','export action lost');
      document.querySelector('details summary').click();await pause(20);
      [...document.querySelectorAll('button')].find(b=>b.textContent.includes('复制问题摘要')).click();check(document.documentElement.dataset.action==='copy','summary action lost');
      check(document.documentElement.scrollWidth<=innerWidth,'desktop help layout overflows');
    })()`);
    if (process.env.SHANGHAO_TEST_SCREENSHOT) {
      view.show();
      await view.webContents.executeJavaScript(
        `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
      );
      require("node:fs").writeFileSync(
        process.env.SHANGHAO_TEST_SCREENSHOT,
        (await view.webContents.capturePage()).toPNG(),
      );
    }
    view.setSize(460, 900);
    await view.webContents.executeJavaScript(
      `(async()=>{await new Promise(r=>setTimeout(r,100));if(document.documentElement.scrollWidth>innerWidth)throw Error('narrow help layout overflows')})()`,
    );
    console.log(
      JSON.stringify({
        guidedActions: 5,
        exportPreserved: true,
        rawPanelsRemoved: true,
        noRuntimeProbe: true,
        responsive: true,
      }),
    );
    clearTimeout(timeout);
    view.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    clearTimeout(timeout);
    view.destroy();
    app.exit(1);
  }
});
