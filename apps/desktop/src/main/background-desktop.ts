import { randomUUID } from "node:crypto";
import {
  app,
  dialog,
  ipcMain,
  Notification,
  powerMonitor,
  type BrowserWindow,
  type Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { IPC_CHANNELS, isPrivateRoomId, type PrivateRoomInfo } from "@private-voice/shared";
import type { AccountDesktopService } from "./account-service";
import type { SettingsStore } from "./settings-store";
import type { PrivateRoomsDesktopService } from "./private-rooms-service";
import { cleanTrayRoomName, RoomPresenceWatcher } from "./room-presence-watcher";
import { updateTrayPresence } from "./tray";
import { sendToWindow } from "./safe-web-contents";

export const requireBackgroundActivity = (
  input: unknown,
): { inRoom: boolean; isRecording: boolean } => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("invalid_background_activity");
  const activity = input as { inRoom?: unknown; isRecording?: unknown };
  if (typeof activity.inRoom !== "boolean" || typeof activity.isRecording !== "boolean")
    throw new Error("invalid_background_activity");
  return { inRoom: activity.inRoom, isRecording: activity.isRecording };
};

/** Owns desktop background lifecycle only; Renderer room owner performs media cleanup. */
export const registerBackgroundDesktop = ({
  window,
  getTray,
  settings,
  accounts,
  rooms,
  isQuitting,
  trace,
}: {
  window: BrowserWindow;
  getTray: () => Tray | null;
  settings: SettingsStore;
  accounts: AccountDesktopService;
  rooms: PrivateRoomsDesktopService;
  isQuitting: () => boolean;
  trace: (reason: string) => void;
}) => {
  let activity = { inRoom: false, isRecording: false };
  let suspended = false;
  let online: PrivateRoomInfo[] = [];
  let closeBusy = false;
  let disposed = false;
  let pendingClose: { id: string; resolve: (left: boolean) => void } | undefined;
  const notifications = new Set<Notification>();
  const context = () => {
    const account = accounts.getSnapshot();
    const config = settings.getSnapshot();
    return {
      scope:
        account.status === "signed_in" && account.profile
          ? `${config.relayServerUrl ?? ""}|${account.profile.userId}`
          : undefined,
      enabled:
        config.isFriendOnlineNotificationEnabled &&
        config.isSystemNotificationEnabled &&
        Notification.isSupported(),
      foreground:
        !window.isDestroyed() && window.isVisible() && window.isFocused() && !window.isMinimized(),
      inRoom: activity.inRoom || activity.isRecording,
      suspended,
    };
  };
  const showWindow = () => {
    if (window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  };
  const preview = (roomId: string) => {
    if (!isPrivateRoomId(roomId)) return;
    showWindow();
    sendToWindow(window, IPC_CHANNELS.app.backgroundCommand, { kind: "preview-room", roomId });
  };
  const updateTray = () => updateTrayPresence(getTray(), online, activity, preview);
  const notify = (title: string, body: string, click: () => void) => {
    if (!settings.getSnapshot().isSystemNotificationEnabled || !Notification.isSupported())
      return false;
    const notification = new Notification({ title, body, silent: false });
    notifications.add(notification);
    notification.once("click", () => {
      notifications.delete(notification);
      click();
    });
    notification.once("close", () => notifications.delete(notification));
    notification.once("failed", () => {
      notifications.delete(notification);
      trace("background_notification_failed");
    });
    while (notifications.size > 4) {
      const old = notifications.values().next().value!;
      old.close();
      notifications.delete(old);
    }
    notification.show();
    return true;
  };
  const watcher = new RoomPresenceWatcher({
    context,
    mine: (signal) => rooms.mine(signal),
    favorites: async () => (await rooms.history()).favorites,
    get: (id, signal) => rooms.get(id, signal),
    foregroundBusy: () => rooms.getPendingCount() > 0,
    trace,
    updateTray: (next) => {
      online = next;
      updateTray();
    },
    notify: (room) => {
      const scope = context().scope;
      notify(`${cleanTrayRoomName(room.name)}有 ${room.onlineCount} 人在线`, "点击查看房间", () => {
        if (scope && scope === context().scope) preview(room.roomId);
      });
    },
  });
  const sender = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    if (
      window.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw new Error("invalid_background_sender");
  };
  ipcMain.handle(IPC_CHANNELS.app.backgroundActivity, (event, input: unknown) => {
    sender(event);
    const next = requireBackgroundActivity(input);
    const changed = activity.inRoom !== next.inRoom || activity.isRecording !== next.isRecording;
    activity = next;
    if (changed) updateTray();
    watcher.refresh();
  });
  ipcMain.handle(
    IPC_CHANNELS.app.completeBackgroundClose,
    (event, requestId: unknown, left: unknown) => {
      sender(event);
      if (typeof requestId !== "string" || requestId.length > 64 || typeof left !== "boolean")
        throw new Error("invalid_background_close");
      if (pendingClose?.id === requestId)
        pendingClose.resolve(left && !activity.inRoom && !activity.isRecording);
    },
  );
  const hide = async () => {
    if (closeBusy || window.isDestroyed() || isQuitting()) return;
    closeBusy = true;
    try {
      if (activity.inRoom || activity.isRecording) {
        const result = await dialog.showMessageBox(window, {
          type: "question",
          title: "留在后台",
          message: "如何处理当前通话？",
          detail: "继续通话会保持麦克风和录音运行",
          buttons: ["退出房间并最小化", "继续通话并最小化", "取消"],
          defaultId: 0,
          cancelId: 2,
          noLink: true,
        });
        if (result.response === 2 || window.isDestroyed()) return;
        if (result.response === 0) {
          const left = await new Promise<boolean>((resolve) => {
            const id = randomUUID();
            const timer = setTimeout(() => {
              pendingClose = undefined;
              resolve(false);
            }, 60_000);
            pendingClose = {
              id,
              resolve: (left) => {
                clearTimeout(timer);
                pendingClose = undefined;
                resolve(left);
              },
            };
            sendToWindow(window, IPC_CHANNELS.app.backgroundCommand, {
              kind: "leave-and-hide",
              requestId: id,
            });
          });
          if (!left) {
            trace("background_room_leave_incomplete");
            showWindow();
            return;
          }
        }
      }
      if (window.isDestroyed() || isQuitting()) return;
      window.hide();
      updateTray();
      if (
        !settings.getSnapshot().hasSeenTrayNotice &&
        notify("上号仍在托盘运行", "右键托盘图标可退出", showWindow)
      ) {
        await settings
          .save({ hasSeenTrayNotice: true })
          .catch(() => trace("tray_notice_setting_failed"));
      }
    } finally {
      closeBusy = false;
    }
  };
  const onClose = (event: { preventDefault(): void }) => {
    if (!isQuitting() && settings.getSnapshot().minimizeToTray) {
      event.preventDefault();
      void hide().catch(() => trace("background_hide_failed"));
    }
  };
  const refresh = () => watcher.refresh();
  const suspend = () => {
    suspended = true;
    watcher.refresh();
  };
  const resume = () => {
    suspended = false;
    watcher.refresh();
  };
  window.on("close", onClose);
  window.on("focus", refresh);
  window.on("blur", refresh);
  window.on("show", refresh);
  window.on("hide", refresh);
  window.on("minimize", refresh);
  window.on("restore", refresh);
  accounts.on("change", refresh);
  powerMonitor.on("suspend", suspend);
  powerMonitor.on("resume", resume);
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    watcher.stop();
    pendingClose?.resolve(false);
    accounts.removeListener("change", refresh);
    powerMonitor.removeListener("suspend", suspend);
    powerMonitor.removeListener("resume", resume);
    window.removeListener("close", onClose);
    window.removeListener("focus", refresh);
    window.removeListener("blur", refresh);
    window.removeListener("show", refresh);
    window.removeListener("hide", refresh);
    window.removeListener("minimize", refresh);
    window.removeListener("restore", refresh);
    app.removeListener("before-quit", dispose);
    for (const notification of notifications) notification.close();
    notifications.clear();
    ipcMain.removeHandler(IPC_CHANNELS.app.backgroundActivity);
    ipcMain.removeHandler(IPC_CHANNELS.app.completeBackgroundClose);
  };
  app.once("before-quit", dispose);
  window.once("closed", dispose);
  watcher.refresh();
  updateTray();
  return { hide, dispose };
};
