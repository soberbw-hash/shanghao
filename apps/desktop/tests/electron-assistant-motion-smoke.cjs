/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, process, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "assistant-motion");
app.setAppUserModelId("com.sober.shanghao.assistant-test");
const reduced = process.argv.includes("--reduce-motion");
if (reduced) app.commandLine.appendSwitch("force-prefers-reduced-motion");
const reportFile = path.join(
  os.tmpdir(),
  reduced
    ? "shanghao-assistant-motion-reduced-result.json"
    : "shanghao-assistant-motion-result.json",
);
const deadline = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
  let observed;
  const window = new BrowserWindow({
    show: true,
    title: "上号 · 动画回归检查",
    width: 520,
    height: 420,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    const file = path.join(__dirname, "visual", "assistant-motion.html").replaceAll("\\", "/");
    await window.loadURL(`http://127.0.0.1:5173/@fs/${file}`);
    const result = (observed = await window.webContents.executeJavaScript(
      `(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let i=0;i<40&&!document.querySelector('#fixture-open');i++) await pause(50);
      const click = selector => { const button=document.querySelector(selector); if(!button) throw Error('Missing '+selector); button.click(); };
      click('#fixture-open'); await pause(350);
      const shell=document.querySelector('.chat-ai-welcome-shell');
      const shortWidth=document.querySelector('.chat-ai-action-morph').getBoundingClientRect().width;
      click('.chat-ai-welcome-action'); await pause(600);
      const expandedWidth=document.querySelector('.chat-ai-action-morph').getBoundingClientRect().width;
      const image=document.querySelector('.assistant-bot-companion img');
      const imageLoaded=image.complete&&image.naturalWidth>0;
      click('.assistant-bot-companion'); await pause(150);
      const interacted=document.querySelector('.assistant-bot-companion').dataset.mood==='greeting';
      click('.chat-ai-welcome-close');
      const frames=await new Promise(resolve=>{
        const samples=[];let start;
        const sample=time=>{start??=time;const height=shell.getBoundingClientRect().height;const button=document.querySelector('.chat-ai-welcome-action');samples.push({height,flashedButton:Boolean(button&&height>1&&Number(getComputedStyle(shell).opacity)>.05)}); if(time-start<350)requestAnimationFrame(sample);else resolve(samples)};
        requestAnimationFrame(sample);
      });
      click('#fixture-open'); await pause(350);
      const reopened=Boolean(document.querySelector('.chat-ai-welcome-action'));
      click('.chat-ai-welcome-close'); await pause(350);
      const plainCloseHeight=shell.getBoundingClientRect().height;
      return {shortWidth,expandedWidth,imageLoaded,interacted,frames,reopened,plainCloseHeight,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
    })()`,
      true,
    ));
    assert.ok(result.imageLoaded);
    assert.ok(result.interacted, "mascot interaction did not respond");
    if (reduced) assert.equal(result.reducedMotion, true);
    assert.ok(result.expandedWidth > result.shortWidth + 30);
    assert.ok(result.frames.length > 5);
    assert.ok(
      result.frames.every((frame) => !frame.flashedButton),
      "CTA flashed during close",
    );
    for (let i = 1; i < result.frames.length; i++)
      assert.ok(
        result.frames[i].height <= result.frames[i - 1].height + 1,
        "Close animation grew again",
      );
    assert.ok(result.frames.at(-1).height < 1);
    assert.ok(result.reopened);
    assert.ok(result.plainCloseHeight < 1);
    await fs.writeFile(reportFile, JSON.stringify({ passed: true, ...result }, null, 2));
    console.log(
      JSON.stringify({ passed: true, frames: result.frames.length, reopened: result.reopened }),
    );
    clearTimeout(deadline);
    window.destroy();
    app.quit();
  } catch (error) {
    await fs.writeFile(
      reportFile,
      JSON.stringify({ passed: false, error: String(error.stack), observed }, null, 2),
    );
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
