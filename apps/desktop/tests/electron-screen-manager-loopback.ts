import { app, BrowserWindow, ipcMain, session } from "electron";
import path from "node:path";
import { IPC_CHANNELS } from "@private-voice/shared";
import { ScreenCaptureService } from "../src/main/screen-capture-service";
require(path.resolve("tests/electron-isolated-profile.cjs")).configureIsolatedProfile(
  app,
  "screen-manager-loopback",
);
const timeout = setTimeout(() => app.exit(1), 35_000);
void app.whenReady().then(async () => {
  const service = new ScreenCaptureService();
  ipcMain.handle(IPC_CHANNELS.app.writeLog, () => undefined);
  ipcMain.handle(IPC_CHANNELS.screenShareViewer.close, () => true);
  ipcMain.handle(IPC_CHANNELS.screenCapture.listSources, () => service.listSources());
  ipcMain.handle(IPC_CHANNELS.screenCapture.selectSource, (_event, id: string) =>
    service.selectSource(id),
  );
  ipcMain.handle(IPC_CHANNELS.screenCapture.setContentProtection, (_event, enabled: boolean) =>
    service.setContentProtection(enabled),
  );
  ipcMain.handle(IPC_CHANNELS.remoteControl.getCapture, () => undefined);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(permission === "media" || permission === "display-capture"),
  );
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    const selected = service.consumeSelectedSourceId();
    const source = selected ? await service.resolveRequestedSource(selected) : undefined;
    callback(source ? { video: source } : {});
  });
  const view = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.resolve("dist-electron/preload/index.cjs"),
      backgroundThrottling: false,
    },
  });
  try {
    const file = path.resolve("tests/visual/screen-manager-loopback.html").replaceAll("\\", "/");
    await view.loadURL(`http://127.0.0.1:5174/@fs/${file}`);
    const result = await view.webContents.executeJavaScript(`(async()=>{
      for(let i=0;i<100&&!window.runScreenManagerLoopback;i++)await new Promise(r=>setTimeout(r,50));
      return window.runScreenManagerLoopback();
    })()`);
    process.stdout.write(JSON.stringify(result) + "\n");
    clearTimeout(timeout);
    app.exit(result.ok ? 0 : 1);
  } catch (error) {
    process.stderr.write(String(error) + "\n");
    clearTimeout(timeout);
    app.exit(1);
  }
});
