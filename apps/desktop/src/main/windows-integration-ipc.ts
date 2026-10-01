import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS, type RendererLogPayload } from "@private-voice/shared";
import {
  configureWindowsIconOverlays,
  readWindowsIntegrationStatus,
  removeWindowsIntegrationFirewall,
  repairWindowsIntegrationFirewall,
} from "./windows-integration";

export const assertSystemOperationSender = (
  event: IpcMainInvokeEvent,
  window: BrowserWindow | null,
): void => {
  if (
    !window ||
    window.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("untrusted_system_operation_sender");
};

/** No scripts, executable paths or arbitrary operation names cross this IPC boundary. */
export const registerWindowsIntegrationIpc = (
  getWindow: () => BrowserWindow | null,
  writeLog: (payload: RendererLogPayload) => Promise<void>,
): void => {
  ipcMain.handle(IPC_CHANNELS.windows.getStatus, () => readWindowsIntegrationStatus());
  ipcMain.handle(IPC_CHANNELS.windows.repairFirewall, async (event) => {
    assertSystemOperationSender(event, getWindow());
    const status = await repairWindowsIntegrationFirewall();
    await writeLog({
      category: "app",
      level: status.healthy ? "info" : "warn",
      message: "Windows firewall rules repaired",
      context: { ...status },
    });
    return status;
  });
  ipcMain.handle(IPC_CHANNELS.windows.removeFirewall, async (event) => {
    assertSystemOperationSender(event, getWindow());
    const status = await removeWindowsIntegrationFirewall();
    await writeLog({
      category: "app",
      level: "info",
      message: "Windows firewall rules removed",
      context: { ...status },
    });
    return status;
  });
  ipcMain.handle(IPC_CHANNELS.windows.setIconOverlaysHidden, async (event, hidden: unknown) => {
    assertSystemOperationSender(event, getWindow());
    if (typeof hidden !== "boolean") throw new Error("invalid_icon_overlay_state");
    const status = await configureWindowsIconOverlays(hidden);
    await writeLog({
      category: "app",
      level: "info",
      message: hidden ? "Windows icon overlays hidden" : "Windows icon overlays restored",
      context: { ...status },
    });
    return status;
  });
};
