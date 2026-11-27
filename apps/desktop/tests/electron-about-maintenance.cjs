/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, __dirname, process, console, setTimeout, clearTimeout */
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
const path = require("node:path");

require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "about-maintenance");
const timeout = setTimeout(() => app.exit(1), 25000);

app.whenReady().then(async () => {
  const view = new BrowserWindow({
    width: 1120,
    height: 940,
    show: false,
    webPreferences: { backgroundThrottling: false, offscreen: true },
  });
  view.webContents.setFrameRate(60);
  view.webContents.startPainting();
  let exitCode = 0;
  view.webContents.on("console-message", (event) => {
    if (event.level === "error") console.error(event.message);
  });
  try {
    const fixture = path.join(__dirname, "fixtures/about-maintenance.html").replaceAll("\\", "/");
    await view.loadURL(
      `${process.env.SHANGHAO_TEST_ORIGIN ?? "http://127.0.0.1:5173"}/@fs/${fixture}`,
    );
    const sectionTimings = await view.webContents.executeJavaScript(`(async () => {
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const assert = (condition, message) => { if (!condition) throw new Error(message); };
      const waitFor = async (read, message) => {
        for (let step = 0; step < 100; step++) {
          const value = read();
          if (value) return value;
          await pause(30);
        }
        throw new Error(message);
      };
      const nav = await waitFor(() => document.querySelector('nav'), 'settings navigation missing');
      const grid = await waitFor(() => document.querySelector('.about-maintenance-grid'), 'legacy diagnostics link no longer opens About');
      const action = document.documentElement.dataset;
      const button = (label, scope = grid) => [...scope.querySelectorAll('button')].find((element) => element.textContent.trim() === label);
      const [logs, storage] = [...grid.querySelectorAll('article')].map((element) => element.getBoundingClientRect());
      assert(logs.top === storage.top && logs.right <= storage.left, 'maintenance cards do not share the desktop row');
      assert(!nav.textContent.includes('诊断'), 'obsolete sidebar section still visible');
      assert(!action.inspected && !action.exported, 'opening About starts maintenance work');

      button('导出日志').click();
      await waitFor(() => action.exported, 'export did not receive the renderer snapshot');
      await waitFor(() => !button('导出日志')?.disabled && button('导出日志'), 'export remained busy');

      button('安全重置').click();
      assert(action.confirmed && !action.reset, 'reset skipped confirmation');
      action.allowReset = 'true';
      button('安全重置').click();
      await waitFor(() => action.reset, 'confirmed reset did not call the settings API');

      button('查看占用').click();
      await waitFor(() => grid.textContent.includes('2.00 GB') && grid.textContent.includes('4.0 MB'), 'storage usage did not render');
      button('清理临时文件').click();
      const canceledDialog = await waitFor(() => document.querySelector('dialog[open]'), 'cleanup did not open a confirmation dialog');
      button('取消', canceledDialog).click();
      assert(!action.cleaned, 'canceling cleanup still deleted files');
      await waitFor(() => !document.querySelector('dialog[open]'), 'canceled dialog stayed open');
      button('清理临时文件').click();
      const dialog = await waitFor(() => document.querySelector('dialog[open]'), 'cleanup dialog could not be reopened');
      button('清理', dialog).click();
      await waitFor(() => action.cleaned && grid.textContent.includes('已清理 2 个') && grid.textContent.includes('0.0 MB'), 'cleanup did not refresh usage and show feedback');

      const names = ['账号', '通用', '语音', '快捷消息', '录音库', 'AI 功能', '关于上号'];
      const timings = [];
      for (let pass = 0; pass < 2; pass++) {
        for (const name of names) {
          const target = button(name, nav);
          const started = performance.now();
          target.click();
          await waitFor(() => target.isConnected && target.getAttribute('aria-current') === 'page' && document.querySelector('.settings-section-motion:not([hidden]) :is(h2,h3)'), 'missing content for ' + name);
          await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          timings.push({ name, pass, firstFrameMs: Math.round(performance.now() - started) });
          await pause(160);
        }
      }
      return timings;
    })()`);
    if (process.env.SHANGHAO_TEST_SCREENSHOT) {
      await view.webContents.executeJavaScript(`(async () => {
        await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
        await new Promise((resolve) => setTimeout(resolve, 400));
      })()`);
      writeFileSync(
        process.env.SHANGHAO_TEST_SCREENSHOT,
        (await view.webContents.capturePage()).toPNG(),
      );
    }
    view.setContentSize(480, 940);
    await view.webContents.executeJavaScript(`(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const [logs, storage] = [...document.querySelectorAll('.about-maintenance-grid article')].map((element) => element.getBoundingClientRect());
      if (logs.bottom > storage.top || storage.right > innerWidth) throw new Error('maintenance cards do not stack inside the narrow window');
    })()`);
    if (process.env.SHANGHAO_TEST_NARROW_SCREENSHOT) {
      await view.webContents.executeJavaScript(
        `(async () => {
          document.querySelector('.about-maintenance-grid').scrollIntoView({ block: 'center' });
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        })()`,
      );
      writeFileSync(
        process.env.SHANGHAO_TEST_NARROW_SCREENSHOT,
        (await view.webContents.capturePage()).toPNG(),
      );
    }
    console.log(JSON.stringify({ maintenance: "wide and narrow passed", sectionTimings }));
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
    view.destroy();
    app.exit(exitCode);
  }
});
