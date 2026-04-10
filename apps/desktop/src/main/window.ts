import path from "node:path";

import { app, BrowserWindow } from "electron";
import { APP_NAME } from "@private-voice/shared";

const devServerUrl = "http://127.0.0.1:5173";

export const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: "#0d1118",
    frame: false,
    titleBarStyle: "hidden",
    title: APP_NAME,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(__dirname, "../../dist/index.html"));
  }

  window.once("ready-to-show", () => {
    window.show();
  });

  return window;
};
