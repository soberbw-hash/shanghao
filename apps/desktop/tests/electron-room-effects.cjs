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
      for (const side of ['::before', '::after']) {
        const style = getComputedStyle(edge, side);
        if (!style.backdropFilter.startsWith('blur(') ||
            !style.maskImage.startsWith('linear-gradient(') ||
            style.pointerEvents !== 'none')
          throw Error('the scroll edge should fade its blur without blocking the list');
      }
      if (getComputedStyle(list.closest('.temporary-chat-panel'), '::after').filter !== 'blur(20px)')
        throw Error('the chat sidebar lacks a softened room background');
      list.scrollTop = list.scrollHeight;
      list.dispatchEvent(new Event('scroll'));
      await pause(100);
      if (!edge.hasAttribute('data-content-above') || edge.hasAttribute('data-content-below'))
        throw Error('latest message still has a bottom blur');
      if (getComputedStyle(edge, '::after').content !== 'none')
        throw Error('the bottom blur should disappear at the latest message');
      const last = list.querySelector('.chat-message-row:last-child').getBoundingClientRect();
      if (last.bottom > list.getBoundingClientRect().bottom - 34)
        throw Error('latest message is covered by the blur');
      const input = composer.querySelector('input[aria-label="聊天消息"]');
      const send = composer.querySelector('button[aria-label="发送消息"]');
      if (!send?.disabled || composer.querySelector('input[type=file], .lucide-plus'))
        throw Error('empty composer has a file picker or an enabled send action');
      const actionRight = send.getBoundingClientRect().right;
      const stage = composer.parentElement.getBoundingClientRect();
      const idleRect = composer.getBoundingClientRect();
      if (Math.abs((idleRect.left - stage.left) - (stage.right - idleRect.right)) > 1)
        throw Error('composer is not aligned inside the chat sidebar');
      const transfer = new DataTransfer();
      transfer.items.add(new File(['test'], '测试.png', { type: 'image/png' }));
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
      await pause(30);
      if ($('main').dataset.image !== '测试.png') throw Error('pasted image did not use image sending');
      input.focus();
      await pause(240);
      if (Math.abs(composerWidth() - idleWidth) > 1 ||
          parseFloat(getComputedStyle(composer).borderTopLeftRadius) !== idleRadius ||
          !getComputedStyle(composer).boxShadow.includes('inset'))
        throw Error('focus moved the composer or painted outside its bounds');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '发个测试');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      for (let attempt = 0; attempt < 40 && send.disabled; attempt++) await pause(20);
      if (send.disabled) throw Error('typing did not enable send');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
      if ($('main').dataset.sent || input.value !== '发个测试')
        throw Error('confirming a composition sent a chat message');
      input.blur();
      await pause(200);
      if (Math.abs(composerWidth() - idleWidth) > 1) throw Error('draft changed the composer width');
      if (Math.abs(send.getBoundingClientRect().right - actionRight) > 1)
        throw Error('the trailing action moved while typing');
      if (composer.querySelector('[aria-label="发送消息"]') !== send || !input.value)
        throw Error('typing replaced the send action or cleared the draft');
      send.click();
      for (let i = 0; i < 25 && !$('[data-message-id="pending"]'); i++) await pause(20);
      const optimistic = list.querySelector('[data-message-id="pending"]');
      if (!optimistic) throw Error('message did not appear before confirmation');
      list.scrollTop = 0;
      $('[data-testid="confirm-chat-message"]').click();
      await pause(320);
      if (optimistic !== list.querySelector('[data-message-id="confirmed"]') || list.scrollTop > 2)
        throw Error('confirmation replaced the row or jumped to the latest message');
      if ($('main').dataset.sent !== '发个测试' || input.value)
        throw Error('sending the draft failed');
      if (!send.disabled) throw Error('the empty composer can still send');
      const bar = $('.room-topbar'), light = bar.querySelector('.room-glass-light');
      bar.dispatchEvent(new PointerEvent('pointermove',{ bubbles:true, clientX:bar.offsetLeft+75, clientY:bar.offsetTop+15 }));
      await pause(60);
      if (!bar.hasAttribute('data-glass-pointer-active') ||
          !getComputedStyle(light,'::before').transform.startsWith('matrix'))
        throw Error('room glass did not move its highlight without moving the controls');
      return { composerAligned: true, draftPreserved: true, imagePaste: true, edgeAware: true, latestMessageReadable: true, glassSpot: true };
    })()`);
    await window.webContents.executeJavaScript(`(async () => {
      const list = document.querySelector('.chat-message-list');
      const middle = list.querySelectorAll('.chat-message-row')[13];
      list.scrollTop += middle.getBoundingClientRect().top - list.getBoundingClientRect().top + 28;
      await new Promise((resolve) => setTimeout(resolve, 130));
      if (!list.parentElement.matches('[data-content-above][data-content-below]'))
        throw Error('the scrolling preview needs both edges');
    })()`);
    await capture("room-chat-history.png");
    await window.webContents.executeJavaScript(`(() => {
      const list = document.querySelector('.chat-message-list');
      list.scrollTop = list.scrollHeight;
    })()`);
    result.screenSourceStaging = await window.webContents.executeJavaScript(`(async () => {
      [...document.querySelectorAll('button')].find(b=>b.textContent==='屏幕分享').click();
      for(let i=0;i<50&&!document.querySelector('main').dataset.screenStarted;i++)
        await new Promise(r=>setTimeout(r,25));
      const modal=document.querySelector('.screen-source-picker-confirm:modal');
      if(!modal || document.querySelector('main').dataset.screenStarted!=='visible')
        throw Error('screen enumeration started before its loading window');
      if(getComputedStyle(modal,'::backdrop').backdropFilter!=='blur(6px)')
        throw Error('the screen picker backdrop lacks soft blur');
      modal.dispatchEvent(new Event('cancel',{ cancelable:true }));
      await new Promise(r=>setTimeout(r,70));
      if(document.querySelector('.screen-source-picker-confirm:modal'))
        throw Error('screen picker could not be dismissed');
      return true;
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
      if (!picker) throw Error('music picker did not open');
      const backdrop = getComputedStyle(picker, '::backdrop');
      if (backdrop.backdropFilter !== 'blur(6px)' || backdrop.animationName !== 'room-picker-backdrop-in')
        throw Error('music picker has no soft room backdrop transition');
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
