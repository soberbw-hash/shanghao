import { app, dialog, ipcMain } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  getRoomChronicleDate,
  IPC_CHANNELS,
  isStoredRoomId,
  MAX_DAILY_CHRONICLE_ENTRIES,
  type RoomChronicleDay,
} from "@private-voice/shared";
import type { AccountDesktopService } from "./account-service";
import type { SettingsStore } from "./settings-store";
import { ChronicleArchiveStore, isLocalChronicleEntry } from "./chronicle-archive-store";

export function registerChronicleArchiveIpc(
  accounts: AccountDesktopService,
  settings: SettingsStore,
) {
  const currentScope = () => {
    const account = accounts.getSnapshot();
    if (account.status !== "signed_in" || !account.profile) throw Error("account_session_expired");
    return JSON.stringify([account.profile.userId, settings.getSnapshot().relayServerUrl]);
  };
  const store = new ChronicleArchiveStore(
    path.join(app.getPath("userData"), "room-chronicles"),
    currentScope,
  );
  ipcMain.handle(
    IPC_CHANNELS.chronicleArchive.export,
    async (_event, roomId, day?: RoomChronicleDay) => {
      const scope = currentScope();
      if (
        day !== undefined &&
        (!day ||
          !isStoredRoomId(roomId) ||
          typeof day.date !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
          !Array.isArray(day.entries) ||
          day.entries.length > MAX_DAILY_CHRONICLE_ENTRIES ||
          !day.entries.every(
            (entry) =>
              isLocalChronicleEntry(entry) &&
              entry.at <= 8.64e15 &&
              getRoomChronicleDate(entry.at) === day.date,
          ))
      )
        throw Error("chronicle_archive_invalid");
      const entries =
        day?.entries.map(({ id, at, text }) => ({ id, at, text })) ?? (await store.read(roomId));
      const result = await dialog.showSaveDialog({
        title: day ? "导出当天房间纪事" : "导出当前房间纪事与评价",
        defaultPath: path.join(
          app.getPath("documents"),
          "上号纪事-" + (day?.date ?? getRoomChronicleDate()) + ".json",
        ),
        filters: [{ name: "纪事资料", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };
      if (currentScope() !== scope) throw Error("chronicle_archive_scope_changed");
      // New files only: an export must never replace recordings or a previous dataset.
      await writeFile(
        result.filePath,
        JSON.stringify(
          { format: "shanghao-chronicle", version: 1, roomId, generatedStories: true, entries },
          null,
          2,
        ),
        { flag: "wx", mode: 0o600 },
      );
      return { saved: true };
    },
  );
  ipcMain.handle(IPC_CHANNELS.chronicleArchive.read, (_event, roomId) => store.read(roomId));
  ipcMain.handle(IPC_CHANNELS.chronicleArchive.append, (_event, roomId, entries) =>
    store.append(roomId, entries),
  );
  ipcMain.handle(IPC_CHANNELS.chronicleArchive.react, (_event, roomId, id, reaction) =>
    store.react(roomId, id, reaction),
  );
}
