import path from "node:path";
import {
  app,
  ipcMain,
  nativeImage,
  shell,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { IPC_CHANNELS } from "@private-voice/shared";
import type { SettingsStore } from "./settings-store";
import { resolveUsableRecordingDirectory } from "./recording-path";
import { RecordingClipExporter } from "./recording-clip-export";
import { requireExportedClip } from "./recording-clip-paths";

export const registerRecordingClipIpc = (
  settings: SettingsStore,
  getWindow: () => BrowserWindow | null,
): void => {
  const exporter = new RecordingClipExporter();
  const directory = () =>
    resolveUsableRecordingDirectory(
      settings.getSnapshot().recordingSaveDirectory,
      app.getPath("documents"),
    );
  const sender = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    const window = getWindow();
    if (
      !window ||
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("clip_invalid_request");
    return window;
  };
  ipcMain.handle(IPC_CHANNELS.recording.exportClip, async (event, request: unknown) => {
    sender(event);
    return exporter.export(await directory(), request);
  });
  ipcMain.handle(IPC_CHANNELS.recording.showClipInFolder, async (event, file: unknown) => {
    sender(event);
    shell.showItemInFolder(await requireExportedClip(await directory(), file));
  });
  ipcMain.on(IPC_CHANNELS.recording.dragClip, (event, file: unknown) => {
    // Native drag must start from a user drag gesture. No arbitrary paths or URLs.
    let window: BrowserWindow;
    try {
      window = sender(event);
    } catch {
      return;
    }
    void directory()
      .then((root) => requireExportedClip(root, file))
      .then((clip) => {
        if (window.isDestroyed()) return;
        const iconPath = app.isPackaged
          ? path.join(process.resourcesPath, "build", "icon.png")
          : path.join(app.getAppPath(), "build", "icon.png");
        window.webContents.startDrag({
          file: clip,
          icon: nativeImage.createFromPath(iconPath).resize({ width: 48, height: 48 }),
        });
      })
      .catch(() => undefined);
  });
  app.once("before-quit", () => exporter.close());
};
