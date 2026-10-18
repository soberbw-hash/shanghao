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
const deadline = setTimeout(() => {
  console.error("assistant fixture timed out");
  app.exit(1);
}, 45000);
app.whenReady().then(async () => {
  console.log("assistant fixture ready");
  let observed;
  const window = new BrowserWindow({
    show: true,
    title: "上号 · 动画回归检查",
    width: 520,
    height: 640,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  try {
    const file = path.join(__dirname, "visual", "assistant-motion.html").replaceAll("\\", "/");
    await window.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${file}`,
    );
    console.log("assistant fixture loaded");
    const result = (observed = await window.webContents.executeJavaScript(
      `(async () => {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      for (let i=0;i<40&&!document.querySelector('#fixture-open');i++) await pause(50);
      const click = selector => { const button=document.querySelector(selector); if(!button) throw Error('Missing '+selector); button.click(); };
      click('#fixture-open'); await pause(350);
      const shell=document.querySelector('.chat-ai-welcome-shell');
      const shortWidth=document.querySelector('.chat-ai-action-morph').getBoundingClientRect().width;
      const titleY=document.querySelector('.chat-ai-welcome-copy > strong').getBoundingClientRect().top;
      const mascotY=document.querySelector('.assistant-bot-companion').getBoundingClientRect().top;
      const originalCardHeight=document.querySelector('.chat-ai-welcome').getBoundingClientRect().height;
      click('.chat-ai-welcome-action'); await pause(600);
      const expandedWidth=document.querySelector('.chat-ai-action-morph').getBoundingClientRect().width;
      const anchored=Math.abs(document.querySelector('.chat-ai-welcome-copy > strong').getBoundingClientRect().top-titleY)<1&&Math.abs(document.querySelector('.assistant-bot-companion').getBoundingClientRect().top-mascotY)<1;
      if(Math.abs(document.querySelector('.chat-ai-welcome').getBoundingClientRect().height-originalCardHeight)>1)throw Error('button morph changed card height: '+JSON.stringify({before:originalCardHeight,after:document.querySelector('.chat-ai-welcome').getBoundingClientRect().height,body:document.querySelector('.room-ask-popover-body').getBoundingClientRect().height}));
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
      click('#fixture-open'); await pause(350); click('.chat-ai-welcome-action'); await pause(600);
      const input=document.querySelector('.room-ai-composer input');
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      setter.call(input,'你可以做什么？'); input.dispatchEvent(new Event('input',{bubbles:true})); await pause(40);
      click('.room-ai-send'); await pause(150);
      const answer=document.querySelector('.room-ai-answer');
      if(!answer) throw Error('No answer rendered');
      if(getComputedStyle(document.querySelector('.chat-ai-welcome-copy > strong')).display!=='none')throw Error('duplicate welcome remained in conversation');
      const body=document.querySelector('.room-ask-inline .room-ask-popover-body');
      const rightEdge=body.getBoundingClientRect().right;
      const history=document.querySelector('.room-question-history');history.open=true;await pause(50);
      const historyEntry=history.querySelector('div button');historyEntry.click();await pause(50);
      if(Math.abs(body.getBoundingClientRect().right-rightEdge)>1)throw Error('history moved scrolling edge');
      const deleteButton=history.querySelector('[title="删除提问"]');
      if(rightEdge-deleteButton.getBoundingClientRect().right<8)throw Error('delete touches scrollbar');
      history.open=false;
      const card=document.querySelector('.chat-ai-welcome');
      const answerWidth=answer.getBoundingClientRect().width, cardWidth=card.getBoundingClientRect().width;
      const composerCleared=input.value==='';
      const historyCollapsed=!document.querySelector('.room-question-history').open;
      const inlineStyle=getComputedStyle(document.querySelector('.room-ask-inline'));
      const harmonyLoaded=(await document.fonts.load('500 16px "HarmonyOS Sans SC"')).length>0;
      const cleanSurface=inlineStyle.boxShadow==='none'&&inlineStyle.backgroundColor==='rgba(0, 0, 0, 0)';
      return {shortWidth,expandedWidth,anchored,imageLoaded,interacted,frames,reopened,plainCloseHeight,answerWidth,cardWidth,composerCleared,historyCollapsed,cleanSurface,harmonyLoaded,inlineShadow:inlineStyle.boxShadow,inlineBackground:inlineStyle.backgroundColor,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
    })()`,
      true,
    ));
    await window.webContents.executeJavaScript(
      `document.querySelector('#fixture-open').style.visibility='hidden'`,
    );
    await fs.writeFile(
      path.join(os.tmpdir(), "shanghao-assistant-conversation.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
    assert.ok(result.imageLoaded);
    assert.ok(result.interacted, "mascot interaction did not respond");
    if (reduced) assert.equal(result.reducedMotion, true);
    assert.ok(result.expandedWidth > result.shortWidth + 30);
    assert.ok(result.anchored, "title or mascot moved during the button-to-input morph");
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
    assert.ok(result.answerWidth > result.cardWidth * 0.85, "answer was squeezed beside mascot");
    assert.ok(result.composerCleared);
    assert.ok(result.historyCollapsed);
    assert.ok(result.cleanSurface, "legacy popover surface leaked into inline card");
    assert.ok(result.harmonyLoaded, "HarmonyOS font failed to load");
    await fs.writeFile(
      path.join(os.tmpdir(), "shanghao-assistant-conversation.png"),
      (await window.webContents.capturePage()).toPNG(),
    );
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
