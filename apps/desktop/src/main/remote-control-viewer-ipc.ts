import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type BrowserWindow } from "electron";
import {
  IPC_CHANNELS,
  type RemoteControlInputEvent,
  type RemoteControlLane,
} from "@private-voice/shared";
import { remoteControlViewerBinding as binding } from "./remote-control-viewer-binding";
import type { RemoteControlService } from "./remote-control-service";

let getViewer: () => BrowserWindow | null | undefined = () => undefined;

export function publishRemoteControlViewerState() {
  const contents = getViewer()?.webContents;
  if (contents && !contents.isDestroyed())
    contents.send(IPC_CHANNELS.screenShareViewer.controlState, binding.snapshot(contents.id));
}
export function registerRemoteControlViewerIpc(
  service: RemoteControlService,
  readViewer: typeof getViewer,
) {
  getViewer = readViewer;
  binding.configure(service);
  const channels = IPC_CHANNELS.screenShareViewer;
  const owner = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    const contents = getViewer()?.webContents;
    if (
      !contents ||
      contents.isDestroyed() ||
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame
    )
      throw Error("invalid_control_viewer");
    return contents.id;
  };
  ipcMain.handle(channels.controlGet, (event) => {
    const id = owner(event);
    service.refresh();
    return binding.snapshot(id);
  });
  ipcMain.handle(channels.controlRequest, (event) => {
    const id = owner(event);
    service.refresh();
    const peer = binding.peer(id);
    return peer ? service.requestControl(peer) : { ok: false, reason: "share-not-requestable" };
  });
  ipcMain.handle(channels.controlCancel, (event) => {
    const peer = binding.peer(owner(event));
    if (peer) service.cancelRequest(peer);
  });
  ipcMain.handle(channels.controlStop, (event) => binding.stop(owner(event)));
  ipcMain.on(channels.controlFrame, (event) => {
    try {
      const id = owner(event),
        peer = binding.peer(id),
        share = peer && binding.snapshot(id).remoteShares[peer];
      if (peer && share) service.observeRemoteFrame(peer, share.shareSessionId);
    } catch {
      /* Untrusted surface. */
    }
  });
  ipcMain.on(
    channels.controlInput,
    (event, input: RemoteControlInputEvent, lane: RemoteControlLane) => {
      try {
        const peer = binding.peer(owner(event));
        if (
          peer &&
          (lane === "pointer" || lane === "reliable") &&
          Buffer.byteLength(JSON.stringify(input)) <= 4096
        )
          service.sendInput(peer, input, lane);
      } catch {
        /* Invalid payloads cannot reach native input. */
      }
    },
  );
}
