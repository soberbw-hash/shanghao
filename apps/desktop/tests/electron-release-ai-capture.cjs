/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, console, process, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "release-ai-capture");
app.commandLine.appendSwitch("force-device-scale-factor", "1");
const deadline = setTimeout(() => app.exit(1), 45000);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1400,
    height: 1000,
    show: false,
    useContentSize: true,
  });
  const version = require("../package.json").version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("invalid_release_version");
  const directory = path.resolve(__dirname, "../../../docs/assets/releases", `v${version}`);
  const load = async (fixture) => {
    await window.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN}/@fs/${path.join(__dirname, "visual", fixture).replaceAll("\\", "/")}`,
    );
    window.showInactive();
    await pause(900);
    await window.webContents.executeJavaScript(
      `document.fonts.load('500 16px "HarmonyOS Sans SC"')`,
    );
  };
  const capture = async (name) => {
    await pause(350);
    await fs.writeFile(
      path.join(directory, name),
      (await window.webContents.capturePage()).toPNG(),
    );
  };
  try {
    await fs.mkdir(directory, { recursive: true });
    await load("settings-feedback.html");
    await window.webContents.executeJavaScript(`(()=>{
      document.querySelector('main > div').style.display='none';
      const asr=document.querySelector('[aria-label="语音转录模型来源"]');asr.value='cloud';asr.dispatchEvent(new Event('change',{bubbles:true}));
      const header=document.createElement('p');header.textContent='上号 · AI 功能演示';header.style.cssText='font-size:20px;font-weight:700;color:#263b56;margin:10px 0 20px';document.querySelector('main').prepend(header);
    })()`);
    await capture("release-ai-settings.png");
    await window.webContents.executeJavaScript(
      `(()=>{const grid=document.querySelector('.ai-model-provider-grid');grid.closest('details').open=true;grid.scrollIntoView({block:'center'});if(grid.getBoundingClientRect().height<100)throw Error('model configuration is still collapsed')})()`,
    );
    await capture("release-models.png");
    await window.webContents.executeJavaScript(`(()=>{
      const text=document.querySelector('select[aria-label="文本整理与问答模型"]');text.value='custom';text.dispatchEvent(new Event('change',{bubbles:true}));
      const asr=document.querySelector('[aria-label="语音转录模型来源"]');asr.value='custom';asr.dispatchEvent(new Event('change',{bubbles:true}));
    })()`);
    await capture("release-models-custom.png");
    window.setContentSize(620, 760);
    await load("assistant-motion.html");
    await window.webContents.executeJavaScript(`(()=>{
      document.querySelector('main').style.width='100%';
      document.querySelector('#fixture-open').click();document.querySelector('#fixture-open').style.cssText='display:none';
      const header=document.createElement('p');header.textContent='上号 AI 助手 · 演示';header.style.cssText='font-size:16px;font-weight:700;color:#263b56;margin:4px 0 20px';document.querySelector('main').prepend(header);
    })()`);
    await pause(350);
    await window.webContents.executeJavaScript(
      `document.querySelector('.chat-ai-welcome-action').click()`,
    );
    await capture("release-assistant.png");
    await window.webContents.executeJavaScript(`(()=>{
      const input=document.querySelector('.room-ai-composer input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'演示：你可以帮我做什么？');input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await pause(170);
    await window.webContents.executeJavaScript(`document.querySelector('.room-ai-send').click()`);
    await window.webContents.executeJavaScript(
      `(async()=>{for(let i=0;i<60;i++){if(document.querySelector('.room-ai-answer'))return;await new Promise(r=>setTimeout(r,50));}throw Error('release demo answer did not render')})()`,
    );
    await capture("release-assistant-answer.png");
    await window.webContents.executeJavaScript(
      `document.querySelector('.room-question-history').open=true`,
    );
    await capture("release-assistant-history.png");
    clearTimeout(deadline);
    window.destroy();
    app.quit();
    console.log("Captured six AI settings, assistant and history screenshots.");
  } catch (error) {
    console.error(error);
    clearTimeout(deadline);
    app.exit(1);
  }
});
