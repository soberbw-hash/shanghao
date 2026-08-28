import { ipcMain } from "electron";

import { IPC_CHANNELS } from "@private-voice/shared";

import { ShortcutController } from "./shortcuts";

export const registerShortcutIpcHandlers = (shortcuts: ShortcutController): void => {
  ipcMain.handle(
    IPC_CHANNELS.shortcuts.configureRecordingMarker,
    async (_event, accelerator: string): Promise<boolean> =>
      shortcuts.configureRecordingMarker(accelerator),
  );
  ipcMain.handle(
    IPC_CHANNELS.shortcuts.configurePushToTalk,
    async (_event, accelerator: string, enabled: boolean): Promise<boolean> => {
      if (typeof accelerator !== "string" || typeof enabled !== "boolean") {
        throw new Error("invalid_push_to_talk_shortcut");
      }
      return shortcuts.configurePushToTalk(accelerator, enabled);
    },
  );
};
