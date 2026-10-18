import { app, BrowserWindow, ipcMain } from "electron";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ShortcutController } from "../src/main/shortcuts";

const directory = mkdtempSync(path.join(os.tmpdir(), "shanghao-phone-input-ui-"));
app.setAppPath(path.resolve(__dirname, "../.."));
app.setPath("userData", directory);
app.setPath("sessionData", path.join(directory, "session"));
app.setAppUserModelId("com.sober.shanghao.phone-input-test");
let window: BrowserWindow;
let phase = "windowed";
const states: { phase: string; active: boolean | undefined }[] = [];
const result = path.join(os.tmpdir(), "shanghao-phone-input-ui-result.json");
const controller = new ShortcutController(() => window);
const configure = () =>
  controller.configurePhone("Ctrl+F10", "hold", (active) => {
    states.push({ phase, active });
    writeFileSync(
      result,
      JSON.stringify({ states, runtime: controller.getRuntimeSnapshot().phone }, null, 2),
    );
    console.log(JSON.stringify({ phase, active }));
  });
app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 650,
    height: 330,
    title: "上号电话快捷键隔离检查",
    frame: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  ipcMain.on("phase", (_event, value) => {
    if (!["windowed", "fullscreen", "borderless"].includes(value)) return;
    phase = value;
    window.setFullScreen(value === "fullscreen");
    if (value === "borderless") window.maximize();
    else if (value === "windowed") window.unmaximize();
  });
  configure();
  await window.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(`
    <title>上号电话快捷键隔离检查</title><body style="font-family:Segoe UI;background:#edf6ff;padding:32px"><h2>电话快捷键隔离检查</h2>
    <p>只观察 Ctrl+F10，不改变任何音频设备。</p><p>窗口 / 全屏 / 最大化无边框样式</p>
    <button onclick="require('electron').ipcRenderer.send('phase','windowed')">窗口</button>
    <button onclick="require('electron').ipcRenderer.send('phase','fullscreen')">全屏</button>
    <button onclick="require('electron').ipcRenderer.send('phase','borderless')">无边框场景</button>
    <button onclick="require('electron').ipcRenderer.send('finish')">完成</button></body>`),
  );
  window.show();
  ipcMain.on("finish", () => app.quit());
});
app.on("before-quit", () => controller.dispose());
setTimeout(() => app.quit(), 600_000).unref();
