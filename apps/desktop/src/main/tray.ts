import path from "node:path";

import { Menu, Tray, app, nativeImage, type BrowserWindow } from "electron";

import { APP_NAME } from "@private-voice/shared";

const getBuildAssetPath = (fileName: string) =>
  app.isPackaged
    ? path.join(process.resourcesPath, "build", fileName)
    : path.join(app.getAppPath(), "build", fileName);

const getTrayImage = () => {
  const fileName = process.platform === "win32" ? "tray-light.png" : "tray-dark.png";
  const image = nativeImage.createFromPath(getBuildAssetPath(fileName));
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
  onQuit: () => void,
): Tray => {
  const tray = new Tray(getTrayImage());

  const renderMenu = () =>
    Menu.buildFromTemplate([
      {
        label: `\u663E\u793A${APP_NAME}`,
        click: () => restoreWindow(getWindow()),
      },
      {
        label: "\u9690\u85CF\u7A97\u53E3",
        click: () => getWindow()?.hide(),
      },
      { type: "separator" },
      {
        label: "\u9000\u51FA",
        click: () => {
          onQuit();
          app.quit();
        },
      },
    ]);

  tray.setToolTip(APP_NAME);
  tray.setContextMenu(renderMenu());
  tray.on("click", () => restoreWindow(getWindow()));
  tray.on("double-click", () => restoreWindow(getWindow()));

  return tray;
};
