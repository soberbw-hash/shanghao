import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { promises as fs } from "node:fs";
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
  ipcMain.handle(IPC_CHANNELS.cloudAiAdmin.importKey, async (event) => {
    check(event);
    const parent = window();
    if (!parent || parent.isDestroyed()) return false;
    const result = await dialog.showOpenDialog(parent, {
      title: "选择上号管理员密钥文件",
      properties: ["openFile"],
      filters: [{ name: "上号管理员密钥", extensions: ["json"] }],
    });
    if (result.canceled || result.filePaths.length !== 1) return false;
    check(event);
    try {
      const file = result.filePaths[0]!;
      const info = await fs.lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 2048)
        throw Error("cloud_ai_admin_key_invalid");
      const handle = await fs.open(file, "r");
      let text: string;
      try {
        const opened = await handle.stat();
        if (
          !opened.isFile() ||
          opened.size < 1 ||
          opened.size > 2048 ||
          opened.ino !== info.ino ||
          opened.dev !== info.dev
        )
          throw Error("cloud_ai_admin_key_invalid");
        const buffer = Buffer.alloc(2049);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead !== opened.size) throw Error("cloud_ai_admin_key_invalid");
        text = buffer.subarray(0, bytesRead).toString("utf8");
        buffer.fill(0);
      } finally {
        await handle.close();
      }
      const value: unknown = JSON.parse(text);
      if (
        !value ||
        typeof value !== "object" ||
        !("version" in value) ||
        value.version !== 1 ||
        !("origin" in value) ||
        typeof value.origin !== "string" ||
        !("key" in value) ||
        typeof value.key !== "string"
      )
        throw Error("cloud_ai_admin_key_invalid");
      check(event);
      return await client.importAdminKey(value.origin, value.key);
    } catch (error) {
      if (error instanceof Error && /^cloud_ai_admin_[a-z_]+$/.test(error.message)) throw error;
      // Never attach file paths or malformed key contents to an error crossing IPC.
      // eslint-disable-next-line preserve-caught-error
      throw Error("cloud_ai_admin_key_invalid");
    }
  });
}
