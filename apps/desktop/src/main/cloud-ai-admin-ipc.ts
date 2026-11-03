import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS, type CloudAiAdminMutation } from "@private-voice/shared";
import type { BuiltInAiClient } from "./built-in-ai-client";

export function registerCloudAiAdminIpc(
  window: () => BrowserWindow | null,
  client: BuiltInAiClient,
): void {
  const check = (event: IpcMainInvokeEvent) => {
    const contents = window()?.webContents;
    if (
      !contents ||
      contents.isDestroyed() ||
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame
    )
      throw Error("cloud_ai_admin_forbidden");
  };
  ipcMain.handle(IPC_CHANNELS.cloudAiAdmin.get, (event) => {
    check(event);
    return client.adminSnapshot();
  });
  ipcMain.handle(IPC_CHANNELS.cloudAiAdmin.change, (event, input: CloudAiAdminMutation) => {
    check(event);
    return client.adminChange(input);
  });
}
