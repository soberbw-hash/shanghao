import path from "node:path";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { app, ipcMain, shell, type BrowserWindow } from "electron";
import { IPC_CHANNELS } from "@private-voice/shared";
import { platformService } from "./platform/PlatformService";

export const registerAssetStudioIpc = (getWindow: () => BrowserWindow | null): void => {
  const ensureReady = async () => {
    const root = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources");
    await access(path.join(root, "asset-studio", "manifest.json"));
  };
  const authorize = (event: Electron.IpcMainInvokeEvent) => {
    const window = getWindow();
    if (
      !window ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("无效工作室请求");
  };
  ipcMain.handle(IPC_CHANNELS.app.openAssetStudio, async (event) => {
    authorize(event);
    await ensureReady();
    const args = [...(app.isPackaged ? [] : [app.getAppPath()]), "--asset-studio"];
    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
  });
  ipcMain.handle(IPC_CHANNELS.app.createAssetStudioShortcut, async (event) => {
    authorize(event);
    await ensureReady();
    if (!platformService.isWindows) throw new Error("桌面入口仅支持 Windows");
    const root = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources");
    const args = `${app.isPackaged ? "" : `"${app.getAppPath()}" `}--asset-studio`;
    if (
      !shell.writeShortcutLink(path.join(app.getPath("desktop"), "上号素材.lnk"), "create", {
        target: process.execPath,
        args,
        cwd: path.dirname(process.execPath),
        icon: path.join(root, "asset-studio", "studio.ico"),
        iconIndex: 0,
        description: "查看上号素材、动态天气与角色动作",
        appUserModelId: "ShangHao.AssetStudio",
      })
    )
      throw new Error("桌面入口未创建，请检查桌面是否可写");
  });
};
