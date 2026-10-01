import path from "node:path";

import { Menu, Tray, app, nativeImage, type BrowserWindow } from "electron";

import { APP_NAME, type PrivateRoomInfo } from "@private-voice/shared";
import { cleanTrayRoomName } from "./room-presence-watcher";
import { platformService } from "./platform/PlatformService";

const controllers = new WeakMap<
  Tray,
  (
    rooms: PrivateRoomInfo[],
    activity: { inRoom: boolean; isRecording: boolean },
    preview: (id: string) => void,
  ) => void
>();
export const updateTrayPresence = (
  tray: Tray | null,
  rooms: PrivateRoomInfo[],
  activity: { inRoom: boolean; isRecording: boolean },
  preview: (id: string) => void,
): void => {
  if (tray && !tray.isDestroyed()) controllers.get(tray)?.(rooms, activity, preview);
};

const getBuildAssetPath = (fileName: string) =>
  app.isPackaged
    ? path.join(process.resourcesPath, "build", fileName)
    : path.join(app.getAppPath(), "build", fileName);

const getTrayImage = () => {
  // Windows selects the correct ICO frame for the taskbar's current DPI.
  if (platformService.isWindows) return getBuildAssetPath("shanghao-icon-v4.ico");
  const image = nativeImage.createFromPath(getBuildAssetPath("icon.png"));
  return image.resize({ width: 18, height: 18 });
};

const restoreWindow = (window: BrowserWindow | null) => {
  if (!window) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.focus();
};

export const createTrayController = (
  getWindow: () => BrowserWindow | null,
  onQuit: () => boolean | Promise<boolean>,
  onHide?: () => void,
): Tray => {
  const tray = new Tray(getTrayImage());

  let rooms: PrivateRoomInfo[] = [];
  let previewRoom = (_id: string) => {};
  const renderMenu = () =>
    Menu.buildFromTemplate([
      {
        label: `\u663E\u793A${APP_NAME}`,
        click: () => restoreWindow(getWindow()),
      },
      {
        label: "\u9690\u85CF\u7A97\u53E3",
        click: () => (onHide ? onHide() : getWindow()?.hide()),
      },
      ...rooms.slice(0, 8).map((room) => ({
        label: `查看「${cleanTrayRoomName(room.name)}」（${room.onlineCount}/${room.capacity}）`,
        click: () => {
          restoreWindow(getWindow());
          previewRoom(room.roomId);
        },
      })),
      { type: "separator" },
      {
        label: "\u9000\u51FA",
        click: async () => {
          if (await onQuit()) app.quit();
        },
      },
    ]);

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(renderMenu());
  controllers.set(tray, (online, activity, preview) => {
    rooms = online;
    previewRoom = preview;
    const status = [activity.inRoom ? "通话中" : "", activity.isRecording ? "录音中" : ""].filter(
      Boolean,
    );
    const labels = rooms
      .slice(0, 2)
      .map((room) => `${cleanTrayRoomName(room.name)} ${room.onlineCount}/${room.capacity}`);
    tray.setToolTip([APP_NAME, ...status, ...labels].join(" · ").slice(0, 100));
    tray.setContextMenu(renderMenu());
  });
  tray.on("click", () => restoreWindow(getWindow()));
  tray.on("double-click", () => restoreWindow(getWindow()));

  return tray;
};
