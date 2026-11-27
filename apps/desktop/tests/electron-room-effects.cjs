/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const os = require("node:os");
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
  window.webContents.setFrameRate(60);
  window.webContents.startPainting();
  try {
    const fixture = path.resolve(
      process.env.SHANGHAO_ROOM_EFFECTS_FIXTURE ??
        path.join(__dirname, "../../../artifacts/native-ui/room-effects.static.html"),
    );
    const previews =
      process.env.SHANGHAO_ROOM_EFFECTS_PREVIEWS ?? path.join(os.tmpdir(), "shanghao-room-effects");
    const capture = async (name) =>
      writeFile(path.join(previews, name), (await window.webContents.capturePage()).toPNG());
    await mkdir(previews, { recursive: true });
    if (process.env.SHANGHAO_TEST_ORIGIN) {
      const page = path.join(__dirname, "visual/room-effects.html").replaceAll("\\", "/");
      await window.loadURL(`${process.env.SHANGHAO_TEST_ORIGIN}/@fs/${page}`);
    } else await window.loadFile(fixture);
    window.webContents.debugger.attach();
    await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", {
      enabled: true,
    });
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
      list.scrollTop = Math.floor((list.scrollHeight - list.clientHeight) / 2);
      list.dispatchEvent(new Event('scroll'));
      await pause(100);
      if (!edge.hasAttribute('data-content-above') || !edge.hasAttribute('data-content-below'))
        throw Error('both clipped edges should fade while scrolling through history: '+ JSON.stringify({ scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight, flags: edge.getAttributeNames() }));
      if (getComputedStyle(edge, '::before').backdropFilter !== 'blur(5px)' ||
          getComputedStyle(edge, '::after').backdropFilter !== 'blur(15px)' ||
          getComputedStyle(edge, '::after').pointerEvents !== 'none')
        throw Error('the progressive edge should blur only the visible list');
      if (getComputedStyle(list.closest('.temporary-chat-panel'), '::after').filter !== 'blur(20px)')
        throw Error('the chat sidebar lacks a softened room background');
      list.scrollTop = list.scrollHeight;
      list.dispatchEvent(new Event('scroll'));
      await pause(100);
      if (!edge.hasAttribute('data-content-above') || edge.hasAttribute('data-content-below'))
        throw Error('latest message still has a bottom blur');
      const last = list.querySelector('.chat-message-row:last-child').getBoundingClientRect();
      if (last.bottom > list.getBoundingClientRect().bottom - 34)
        throw Error('latest message is covered by the blur');
      const input = composer.querySelector('input[aria-label="聊天消息"]');
      const attach = composer.querySelector('button[aria-label="选择并发送图片"]');
      if (!attach || attach.disabled) throw Error('empty chat has no image action');
      const actionRight = attach.getBoundingClientRect().right;
      const centered = (glyph) => {
        const a = attach.getBoundingClientRect(), b = attach.querySelector(glyph).getBoundingClientRect();
        return Math.abs((a.left + a.right - b.left - b.right) / 2) < 1;
      };
      if (!centered('.chat-attach-icon')) throw Error('attachment glyph is off-center');
      const picker = composer.querySelector('input[type=file]');
      let openedPicker = false;
      picker.click = () => { openedPicker = true; };
      attach.click();
      if (!openedPicker) throw Error('image button did not open native input');
      const transfer = new DataTransfer();
      transfer.items.add(new File(['test'], '测试.png', { type: 'image/png' }));
      picker.files = transfer.files;
      picker.dispatchEvent(new Event('change',{bubbles:true}));
      await pause(30);
      if ($('main').dataset.image !== '测试.png') throw Error('file selection did not use image sending');
      input.focus();
      await pause(240);
      if (composerWidth() < idleWidth + 10) throw Error('focused composer does not expand');
      if (parseFloat(getComputedStyle(composer).borderTopLeftRadius) >= idleRadius)
        throw Error('focused composer does not change shape');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '发个测试');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      for (let attempt = 0; attempt < 40 && composer.dataset.hasDraft !== 'true'; attempt++) await pause(20);
      if (composer.dataset.hasDraft !== 'true') throw Error('typing did not update the draft state');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
      if ($('main').dataset.sent || input.value !== '发个测试')
        throw Error('confirming a composition sent a chat message');
      input.blur();
      await pause(200);
      if (composerWidth() < idleWidth + 10) throw Error('draft collapsed on blur: ' + JSON.stringify({ idleWidth, width: composerWidth(), draft: composer.dataset.hasDraft }));
      if (Math.abs(attach.getBoundingClientRect().right - actionRight) > 1 || !centered('.chat-send-icon'))
        throw Error('the trailing action moved while typing');
      if (composer.querySelector('[aria-label="发送消息"]') !== attach || !input.value)
        throw Error('typing replaced the action instead of transitioning its state');
      attach.click();
      for (let i = 0; i < 25 && !$('[data-message-id="pending"]'); i++) await pause(20);
      const sendGlyph = attach.querySelector('.chat-send-icon');
      const iconOwnsItsTransition = !sendGlyph.style.opacity && !sendGlyph.style.transform;
      const optimistic = list.querySelector('[data-message-id="pending"]');
      if (!optimistic) throw Error('message did not appear before confirmation: ' + JSON.stringify({sent: $('main').dataset.sent, label: attach.ariaLabel, disabled: attach.disabled, latest: list.lastElementChild?.dataset.messageId}));
      list.scrollTop = 0;
      $('[data-testid="confirm-chat-message"]').click();
      await pause(320);
      if (optimistic !== list.querySelector('[data-message-id="confirmed"]') || list.scrollTop > 2)
        throw Error('confirmation replaced the row or jumped to the latest message: ' + JSON.stringify({replaced: optimistic !== list.querySelector('[data-message-id="confirmed"]'), scrollTop: list.scrollTop, iconOwnsItsTransition}));
      if (!iconOwnsItsTransition) throw Error('send animation overrides the composer icon transition');
      if ($('main').dataset.sent !== '发个测试' || input.value)
        throw Error('sending the draft failed');
      if (composer.querySelector('[aria-label="选择并发送图片"]') !== attach)
        throw Error('attachment action did not return after sending');
      const bar = $('.room-topbar'), light = bar.querySelector('.room-glass-light');
      bar.dispatchEvent(new PointerEvent('pointermove',{ bubbles:true, clientX:bar.offsetLeft+75, clientY:bar.offsetTop+15 }));
      await pause(60);
      if (!bar.hasAttribute('data-glass-pointer-active') ||
          !getComputedStyle(light,'::before').transform.startsWith('matrix'))
        throw Error('room glass did not move its highlight without moving the controls');
      return { composerExpanded: true, draftPreserved: true, imageAction: true, edgeAware: true, latestMessageReadable: true, glassSpot: true };
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
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-reduced-motion", value: "reduce" },
        { name: "forced-colors", value: "active" },
      ],
    });
    const accessibleEffects = await window.webContents.executeJavaScript(`(() => {
      const list = document.querySelector('.chat-message-list');
      const composer = document.querySelector('.chat-composer');
      return getComputedStyle(list).maskImage === 'none' &&
        getComputedStyle(composer).transitionDuration === '0s' &&
        getComputedStyle(document.querySelector('.room-glass-light')).display === 'none';
    })()`);
    if (!accessibleEffects)
      throw Error("room effects still obscure content with accessibility settings");
    console.log(
      JSON.stringify({
        ...result,
        refractionRendered: true,
        musicVolumeWorks: true,
        narrowMusicLayout: true,
        accessibleEffects: true,
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
