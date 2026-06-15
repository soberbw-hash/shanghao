import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { app, BrowserWindow, screen } from "electron";

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
    let savedBounds: { x?: number; y?: number } = {};
    try {
      if (existsSync(boundsPath)) {
        savedBounds = JSON.parse(readFileSync(boundsPath, "utf8")) as typeof savedBounds;
      }
    } catch {
      savedBounds = {};
    }

    const workArea = screen.getPrimaryDisplay().workArea;
    const window = new BrowserWindow({
      width: 48,
      height: 48,
      x: savedBounds.x ?? workArea.x + 12,
      y: savedBounds.y ?? workArea.y + Math.round((workArea.height - 48) / 2),
      minWidth: 48,
      minHeight: 48,
      maxWidth: 48,
      maxHeight: 48,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      show: false,
      closable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/index.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.window = window;
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setMovable(true);

    window.on("closed", () => {
      if (this.window === window) {
        this.window = null;
      }
    });

    window.on("blur", () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.setAlwaysOnTop(true, "screen-saver");
      }
    });

    const saveBounds = () => {
      try {
        const bounds = window.getBounds();
        writeFileSync(boundsPath, JSON.stringify({ x: bounds.x, y: bounds.y }), "utf8");
      } catch {
        // Position memory is optional and must not affect the overlay.
      }
    };
    window.on("moved", saveBounds);
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
