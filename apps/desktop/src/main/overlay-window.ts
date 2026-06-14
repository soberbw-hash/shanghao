import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { app, BrowserWindow } from "electron";

import { IPC_CHANNELS, type OverlayState } from "@private-voice/shared";

const devServerUrl = "http://127.0.0.1:5173";

export class OverlayWindowController {
  private window: BrowserWindow | null = null;
  private state?: OverlayState;

  toggle(): boolean {
    if (this.window && !this.window.isDestroyed()) {
      this.close();
      return false;
    }

    this.create();
    return true;
  }

  close(): void {
    this.window?.destroy();
    this.window = null;
  }

  update(state: OverlayState): void {
    this.state = state;
    if (this.window && !this.window.isDestroyed() && !this.window.webContents.isLoading()) {
      this.window.webContents.send(IPC_CHANNELS.overlay.state, state);
    }
  }

  private create(): void {
    const boundsPath = path.join(app.getPath("userData"), "overlay-bounds.json");
    let savedBounds: { x?: number; y?: number; width?: number; height?: number } = {};
    try {
      if (existsSync(boundsPath)) {
        savedBounds = JSON.parse(readFileSync(boundsPath, "utf8")) as typeof savedBounds;
      }
    } catch {
      savedBounds = {};
    }

    const window = new BrowserWindow({
      width: savedBounds.width ?? 356,
      height: savedBounds.height ?? 118,
      x: savedBounds.x,
      y: savedBounds.y,
      minWidth: 300,
      minHeight: 104,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window = window;
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.on("closed", () => {
      if (this.window === window) {
        this.window = null;
      }
    });
    const saveBounds = () => {
      try {
        writeFileSync(boundsPath, JSON.stringify(window.getBounds()), "utf8");
      } catch {
        // Position memory is optional and must not affect the overlay.
      }
    };
    window.on("moved", saveBounds);
    window.on("resized", saveBounds);
    window.webContents.once("did-finish-load", () => {
      if (this.state) {
        window.webContents.send(IPC_CHANNELS.overlay.state, this.state);
      }
      window.showInactive();
    });

    if (!app.isPackaged) {
      void window.loadURL(`${devServerUrl}?overlay=1`);
    } else {
      void window.loadFile(path.join(__dirname, "../../dist/index.html"), {
        query: { overlay: "1" },
      });
    }
  }
}
