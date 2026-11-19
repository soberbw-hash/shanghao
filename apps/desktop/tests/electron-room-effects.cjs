/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { mkdir, writeFile } = require("node:fs/promises");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "room-effects");

const deadline = setTimeout(() => app.exit(1), 25_000);
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1120,
    height: 730,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  try {
    const fixture = path.resolve(
      process.env.SHANGHAO_ROOM_EFFECTS_FIXTURE ??
        path.join(__dirname, "../../../artifacts/native-ui/room-effects.static.html"),
    );
    const previews = path.dirname(fixture);
    const capture = async (name) =>
      writeFile(path.join(previews, name), (await window.webContents.capturePage()).toPNG());
    await mkdir(previews, { recursive: true });
    await window.loadFile(fixture);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const $ = (selector) => document.querySelector(selector);
      for (let i = 0; i < 80 && !$('.chat-composer'); i++) await pause(30);
      const composer = $('.chat-composer');
      const list = $('.chat-message-list');
      const edge = list.parentElement;
      const composerWidth = () => composer.getBoundingClientRect().width;
      const idleWidth = composerWidth();
      const idleRadius = parseFloat(getComputedStyle(composer).borderTopLeftRadius);
      if (getComputedStyle(edge, '::before').backdropFilter !== 'blur(5px)' ||
          getComputedStyle(edge, '::after').backdropFilter !== 'blur(15px)' ||
          getComputedStyle(edge, '::after').pointerEvents !== 'none')
        throw Error('the progressive edge should blur only the visible list');
      if (getComputedStyle(list.closest('.temporary-chat-panel'), '::after').filter !== 'blur(20px)')
        throw Error('the chat sidebar lacks a softened room background');
      list.scrollTop = list.scrollHeight;
      const last = list.querySelector('.chat-message-row:last-child').getBoundingClientRect();
      if (last.bottom > list.getBoundingClientRect().bottom - 34)
        throw Error('latest message is covered by the blur');
      const input = composer.querySelector('input');
      input.focus();
      await pause(240);
      if (composerWidth() < idleWidth + 10) throw Error('focused composer does not expand');
      if (parseFloat(getComputedStyle(composer).borderTopLeftRadius) >= idleRadius)
        throw Error('focused composer does not change shape');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '发个测试');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await pause(40);
      input.blur();
      await pause(200);
      if (composerWidth() < idleWidth + 10) throw Error('draft collapsed on blur');
      composer.querySelector('[aria-label="发送消息"]').click();
      await pause(240);
      if ($('main').dataset.sent !== '发个测试' || input.value)
        throw Error('sending the draft failed');
      return { composerExpanded: true, draftPreserved: true, latestMessageReadable: true };
    })()`);
    await capture("room-chat-idle.png");
    await window.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector('.chat-composer input');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, "你们听得到吗？");
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const list = document.querySelector('.chat-message-list');
      list.scrollTop = Math.max(0, list.scrollTop - 38);
      await new Promise((resolve) => setTimeout(resolve, 240));
    })()`);
    await capture("room-chat-focused.png");
    await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('[aria-label="打开音乐演示"]').click();
      await new Promise((resolve) => setTimeout(resolve, 160));
      const picker = document.querySelector('dialog:modal[data-sharing="false"]');
      if (!picker || !getComputedStyle(picker).backdropFilter.includes('blur(12px)') ||
          !picker.querySelector('feImage')?.getAttribute('href')?.startsWith('data:image/png'))
        throw Error('the source picker should show glass before music starts');
    })()`);
    await capture("room-music-source-picker.png");
    await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('dialog:modal footer button:last-child').click();
      await new Promise((resolve) => setTimeout(resolve, 160));
      const dialog = document.querySelector('dialog:modal');
      if (!dialog || !getComputedStyle(dialog).backdropFilter.includes('blur(12px)') ||
          !dialog.querySelector('feImage')?.getAttribute('href')?.startsWith('data:image/png'))
        throw Error('the music dialog lacks translucent backdrop');
      const volume = dialog.querySelector('input[type=range]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(volume, '.88');
      volume.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 30));
      if (dialog.querySelector('output').textContent !== '88%') throw Error('music volume does not respond');
    })()`);
    await capture("room-music-glass.png");
    const refracted = (await window.webContents.capturePage()).toBitmap();
    const rimStyle = await window.webContents.executeJavaScript(`(() => {
      const style = document.querySelector('dialog:modal').style;
      const filter = style.getPropertyValue('--audio-glass-rim');
      style.removeProperty('--audio-glass-rim');
      return filter;
    })()`);
    await window.webContents.executeJavaScript(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const blurred = (await window.webContents.capturePage()).toBitmap();
    if (!rimStyle || refracted.equals(blurred))
      throw Error("glass rim leaves the rendered pixels unchanged");
    await window.webContents.executeJavaScript(
      `document.querySelector('dialog:modal').style.setProperty('--audio-glass-rim', ${JSON.stringify(rimStyle)})`,
    );
    await window.webContents.executeJavaScript(`(async () => {
      const room = document.querySelector('main');
      room.style.backgroundImage = 'linear-gradient(rgb(6 24 66 / 65%), rgb(26 19 58 / 65%)), var(--room-wallpaper)';
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    await capture("room-music-glass-dark-background.png");
    window.setContentSize(430, 620);
    const narrow = await window.webContents.executeJavaScript(`(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const dialog = document.querySelector('dialog:modal');
      const bounds = dialog.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth &&
        bounds.top >= 0 && bounds.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth + 1;
    })()`);
    if (!narrow) throw Error("music dialog overflows at 430px");
    console.log(
      JSON.stringify({
        ...result,
        refractionRendered: true,
        musicVolumeWorks: true,
        narrowMusicLayout: true,
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
