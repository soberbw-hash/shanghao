import { ipcMain, type BrowserWindow } from "electron";
import {
  IPC_CHANNELS,
  type ScreenShareViewerOpenRequest,
  type ScreenShareViewerSignal,
} from "@private-voice/shared";
import { remoteControlViewerBinding } from "./remote-control-viewer-binding";
import {
  closeScreenShareViewer,
  getScreenShareViewerWindow,
  isScreenShareViewerSender,
  openScreenShareViewer,
  sendScreenShareViewerSignal,
} from "./window";

/** The detached surface's video signaling and MainFrame-only lifecycle authority. */
export function registerScreenShareViewerIpc(
  getMainWindow: () => BrowserWindow | null | undefined,
  requireString: (value: unknown, maximumLength: number, label: string) => string,
) {
  ipcMain.handle(
    IPC_CHANNELS.screenShareViewer.open,
    async (event, request: ScreenShareViewerOpenRequest): Promise<void> => {
      const main = getMainWindow()?.webContents;
      if (!main || event.sender !== main || event.senderFrame !== main.mainFrame)
        throw Error("invalid_screen_viewer_host");
      if (!request || typeof request !== "object") throw new Error("invalid_screen_viewer_open");
      await openScreenShareViewer({
        title: requireString(request.title, 160, "screen_viewer_title"),
        sessionId: requireString(request.sessionId, 128, "screen_viewer_session"),
        peerId:
          request.peerId === undefined
            ? undefined
            : requireString(request.peerId, 160, "screen_viewer_peer"),
      });
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.screenShareViewer.sendSignal,
    async (event, signal: ScreenShareViewerSignal): Promise<boolean> => {
      if (!signal || typeof signal !== "object") throw new Error("invalid_screen_viewer_signal");
      const sessionId = requireString(signal.sessionId, 128, "screen_viewer_session");
      const sender = signal.sender;
      const type = signal.type;
      if (!(["host", "viewer"] as const).includes(sender)) {
        throw new Error("invalid_screen_viewer_sender");
      }
      if (
        !(["ready", "offer", "answer", "ice", "fallback-frame", "closed"] as const).includes(type)
      ) {
        throw new Error("invalid_screen_viewer_signal_type");
      }
      const mainWindow = getMainWindow();
      if (sender === "host") {
        if (
          !mainWindow ||
          event.sender !== mainWindow.webContents ||
          event.senderFrame !== mainWindow.webContents.mainFrame
        ) {
          throw new Error("invalid_screen_viewer_host");
        }
      } else if (!isScreenShareViewerSender(event.sender.id, sessionId)) {
        throw new Error("invalid_screen_viewer_client");
      }
      if (sender === "viewer" && event.senderFrame !== event.sender.mainFrame)
        throw Error("invalid_screen_viewer_frame");
      if (type === "closed" || type === "fallback-frame" || type === "ready")
        remoteControlViewerBinding.stopSession(sessionId);

      const safeSignal: ScreenShareViewerSignal = {
        sessionId,
        sender,
        type,
        title: signal.title ? requireString(signal.title, 160, "screen_viewer_title") : undefined,
        sdp: signal.sdp ? requireString(signal.sdp, 128_000, "screen_viewer_sdp") : undefined,
        candidate: signal.candidate
          ? requireString(signal.candidate, 8_192, "screen_viewer_candidate")
          : undefined,
        sdpMid: typeof signal.sdpMid === "string" ? signal.sdpMid.slice(0, 128) : signal.sdpMid,
        sdpMLineIndex:
          typeof signal.sdpMLineIndex === "number" ? signal.sdpMLineIndex : signal.sdpMLineIndex,
        frameDataUrl: signal.frameDataUrl
          ? requireString(signal.frameDataUrl, 8 * 1024 * 1024, "screen_viewer_frame")
          : undefined,
      };

      if (sender === "host") return sendScreenShareViewerSignal(safeSignal);
      if (mainWindow && !mainWindow.isDestroyed())
        mainWindow.webContents.send(IPC_CHANNELS.screenShareViewer.signal, safeSignal);
      return Boolean(mainWindow && !mainWindow.isDestroyed());
    },
  );
  ipcMain.handle(IPC_CHANNELS.screenShareViewer.close, async (event): Promise<void> => {
    const main = getMainWindow()?.webContents;
    const viewer = getScreenShareViewerWindow()?.webContents;
    if (
      (event.sender !== main && event.sender !== viewer) ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw Error("invalid_screen_viewer_host");
    closeScreenShareViewer();
  });
}
