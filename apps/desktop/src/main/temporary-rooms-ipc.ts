import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import {
  IPC_CHANNELS,
  type TemporaryRoomManageRequest,
  type TemporaryRoomProfile,
} from "@private-voice/shared";
import { TemporaryIdentityStore, normalizeTemporaryAvatar } from "./temporary-identity-store";
import { TemporaryRoomClient } from "./temporary-room-client";
import type { SignalingClientBridge } from "./signaling-client";
import { TemporaryLanDiscovery } from "./temporary-lan-discovery";
import { TemporaryLanHost } from "./temporary-lan-host";
import { createTemporaryRoomRouter } from "./temporary-room-router";

export function registerTemporaryRoomsIpc(options: {
  getMainWindow: () => BrowserWindow | null | undefined;
  endpoint: () => string;
  signaling: SignalingClientBridge;
}): TemporaryRoomClient {
  const identity = new TemporaryIdentityStore(app.getPath("userData"));
  const discovery = new TemporaryLanDiscovery();
  const host = new TemporaryLanHost({ identity, discovery });
  const client = new TemporaryRoomClient(
    identity,
    options.endpoint,
    undefined,
    createTemporaryRoomRouter({ identity, discovery, host, endpoint: options.endpoint }),
  );
  const requireOwner = (event: IpcMainInvokeEvent) => {
    const owner = options.getMainWindow()?.webContents;
    if (!owner || event.sender !== owner || event.senderFrame !== owner.mainFrame)
      throw Error("temporary_sender_invalid");
  };
  options.signaling.setTemporaryConnectionProvider((url) => client.acquire(url));
  client.onState((state) => {
    const window = options.getMainWindow();
    if (window && !window.isDestroyed())
      window.webContents.send(IPC_CHANNELS.temporaryRooms.changed, state);
  });
  ipcMain.handle(IPC_CHANNELS.temporaryRooms.getProfile, (event) => {
    requireOwner(event);
    return identity.getProfile();
  });
  ipcMain.handle(IPC_CHANNELS.temporaryRooms.prepareAvatar, (event, dataUrl: string) => {
    requireOwner(event);
    return normalizeTemporaryAvatar(dataUrl);
  });
  ipcMain.handle(
    IPC_CHANNELS.temporaryRooms.saveProfile,
    (event, profile: TemporaryRoomProfile) => {
      requireOwner(event);
      return identity.saveProfile(profile);
    },
  );
  ipcMain.handle(IPC_CHANNELS.temporaryRooms.create, (event) => {
    requireOwner(event);
    return client.create();
  });
  ipcMain.handle(IPC_CHANNELS.temporaryRooms.join, (event, code: string) => {
    requireOwner(event);
    return client.join(code);
  });
  ipcMain.handle(
    IPC_CHANNELS.temporaryRooms.manage,
    (event, request: TemporaryRoomManageRequest) => {
      requireOwner(event);
      return client.manage(request);
    },
  );
  ipcMain.handle(IPC_CHANNELS.temporaryRooms.release, (event, id: string) => {
    requireOwner(event);
    client.release(id);
  });
  app.once("before-quit", () => {
    client.close();
    void host.close().finally(() => discovery.stop());
  });
  return client;
}
