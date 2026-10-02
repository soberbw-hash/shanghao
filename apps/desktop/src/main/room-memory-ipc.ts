import { ipcMain, net } from "electron";
import { IPC_CHANNELS } from "@private-voice/shared";
import type { AccountDesktopService } from "./account-service";
import type { SettingsStore } from "./settings-store";
import { RoomMemoryDesktopService } from "./room-memory-service";
export const registerRoomMemoryIpc = (accounts: AccountDesktopService, settings: SettingsStore) => {
  const memories = new RoomMemoryDesktopService(
    accounts,
    () => settings.getSnapshot().relayServerUrl,
    (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
  );
  ipcMain.handle(IPC_CHANNELS.roomMemory.get, (_event, id) => memories.get(id));
  ipcMain.handle(IPC_CHANNELS.roomMemory.save, (_event, request) => memories.save(request));
  return memories;
};
