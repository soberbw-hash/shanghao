import path from "node:path";

import { Menu, Tray, nativeImage, type BrowserWindow, app } from "electron";
import { APP_NAME } from "@private-voice/shared";

const getTrayImage = () => {
  const pngPath = path.join(app.getAppPath(), "build", "icon.png");
  const image = nativeImage.createFromPath(pngPath);
  return image.resize({ width: 20, height: 20 });
};

const restoreWindow = (window: BrowserWindow | null) => {
  if (!window) {
    return;
  }

  if (window.isMinimized()) {
    window.restore();
  }

  window.show();
  window.focus();
};

export const createTrayController = (
  getWindow: () => BrowserWindow | null,
  onQuit: () => void,
): Tray => {
  const tray = new Tray(getTrayImage());

  const renderMenu = () =>
    Menu.buildFromTemplate([
      {
        label: `显示${APP_NAME}`,
        click: () => {
          restoreWindow(getWindow());
        },
      },
      {
        label: "隐藏窗口",
        click: () => getWindow()?.hide(),
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          onQuit();
          app.quit();
        },
      },
    ]);

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(renderMenu());
  tray.on("click", () => {
    restoreWindow(getWindow());
  });
  tray.on("double-click", () => {
    restoreWindow(getWindow());
  });

  return tray;
};
