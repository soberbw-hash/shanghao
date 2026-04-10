import { Menu, Tray, nativeImage, type BrowserWindow, app } from "electron";
import { APP_NAME } from "@private-voice/shared";

const createTrayImage = () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="18" fill="#101722" />
      <circle cx="32" cy="32" r="14" fill="#8bd3ff" />
    </svg>
  `;

  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  );
};

export const createTrayController = (
  getWindow: () => BrowserWindow | null,
  onQuit: () => void,
): Tray => {
  const tray = new Tray(createTrayImage());

  const renderMenu = () =>
    Menu.buildFromTemplate([
      {
        label: `显示${APP_NAME}`,
        click: () => {
          const window = getWindow();
          window?.show();
          window?.focus();
        },
      },
      {
        label: "隐藏",
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
  tray.on("double-click", () => {
    const window = getWindow();
    window?.show();
    window?.focus();
  });

  return tray;
};
