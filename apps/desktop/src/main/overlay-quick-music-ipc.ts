import { ipcMain, type BrowserWindow } from "electron";

import { IPC_CHANNELS, type OverlayQuickMusicMuteRequest } from "@private-voice/shared";

import { sendToWindow } from "./safe-web-contents";

export const registerOverlayQuickMusicMuteHandler = (
  getMainWindow: () => BrowserWindow | null,
): void => {
  ipcMain.handle(
    IPC_CHANNELS.overlay.requestMuteQuickMessage,
    async (_event, request: OverlayQuickMusicMuteRequest): Promise<void> => {
      if (
        !request ||
        typeof request.peerId !== "string" ||
        typeof request.messageId !== "string" ||
        request.peerId.length > 200 ||
        request.messageId.length > 200
      ) {
        throw new Error("invalid_overlay_quick_music_request");
      }
      sendToWindow(getMainWindow(), IPC_CHANNELS.overlay.muteQuickMessage, request);
    },
  );
};
