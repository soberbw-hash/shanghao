import { Menu, Tray, nativeImage, type BrowserWindow, app } from "electron";
import { APP_NAME } from "@private-voice/shared";

const createTrayImage = () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="bg" x1="12" y1="8" x2="52" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#0c1829" />
          <stop offset="1" stop-color="#16273b" />
        </linearGradient>
        <radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(46 18) rotate(135) scale(22)">
          <stop offset="0" stop-color="#79d7ff" stop-opacity="0.55" />
          <stop offset="1" stop-color="#79d7ff" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="accent" x1="37" y1="38" x2="52" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#d8f4ff" />
          <stop offset="1" stop-color="#6ecfff" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#bg)" />
      <rect x="1.5" y="1.5" width="61" height="61" rx="16.5" fill="none" stroke="rgba(255,255,255,0.08)" />
      <circle cx="46" cy="18" r="22" fill="url(#glow)" />
      <rect x="17" y="16" width="30" height="8" rx="4" fill="#eff9ff" />
      <rect x="28" y="16" width="8" height="32" rx="4" fill="#eff9ff" />
      <circle cx="45" cy="45" r="6.5" fill="url(#accent)" />
      <circle cx="47" cy="43" r="1.75" fill="#ffffff" fill-opacity="0.9" />
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
