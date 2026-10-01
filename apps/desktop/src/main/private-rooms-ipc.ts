import { ipcMain, net } from "electron";
import { IPC_CHANNELS, type DesktopApi } from "@private-voice/shared";
import type { AccountDesktopService } from "./account-service";
import type { SettingsStore } from "./settings-store";
import { PrivateRoomsDesktopService } from "./private-rooms-service";
import { PrivateRoomHistoryStore } from "./private-room-history";

export const registerPrivateRoomsIpc = (
  accounts: AccountDesktopService,
  settings: SettingsStore,
  userData: string,
) => {
  const rooms: DesktopApi["rooms"] = new PrivateRoomsDesktopService(
    accounts,
    () => settings.getSnapshot().relayServerUrl,
    new PrivateRoomHistoryStore(userData),
    (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
  );
  ipcMain.handle(IPC_CHANNELS.rooms.mine, () => rooms.mine());
  ipcMain.handle(IPC_CHANNELS.rooms.find, (_event, code) => rooms.find(code));
  ipcMain.handle(IPC_CHANNELS.rooms.get, (_event, id) => rooms.get(id));
  ipcMain.handle(IPC_CHANNELS.rooms.randomCode, () => rooms.randomCode());
  ipcMain.handle(IPC_CHANNELS.rooms.available, (_event, code) => rooms.available(code));
  ipcMain.handle(IPC_CHANNELS.rooms.create, (_event, request) => rooms.create(request));
  ipcMain.handle(IPC_CHANNELS.rooms.update, (_event, request) => rooms.update(request));
  ipcMain.handle(IPC_CHANNELS.rooms.delete, (_event, id) => rooms.delete(id));
  ipcMain.handle(IPC_CHANNELS.rooms.kick, (_event, id, peer) => rooms.kick(id, peer));
  ipcMain.handle(IPC_CHANNELS.rooms.ban, (_event, id, user, name) => rooms.ban(id, user, name));
  ipcMain.handle(IPC_CHANNELS.rooms.unban, (_event, id, user) => rooms.unban(id, user));
  ipcMain.handle(IPC_CHANNELS.rooms.bans, (_event, id) => rooms.bans(id));
  ipcMain.handle(IPC_CHANNELS.rooms.history, () => rooms.history());
  ipcMain.handle(IPC_CHANNELS.rooms.rememberJoined, (_event, id) => rooms.rememberJoined(id));
  ipcMain.handle(IPC_CHANNELS.rooms.favorite, (_event, id, enabled) => rooms.favorite(id, enabled));
};
