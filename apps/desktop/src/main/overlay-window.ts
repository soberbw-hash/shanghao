import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { app, BrowserWindow, screen } from "electron";

import { IPC_CHANNELS, type OverlayState } from "@private-voice/shared";

const devServerUrl = "http://127.0.0.1:5173";

export class OverlayWindowController {
  private window: BrowserWindow | null = null;
  private state?: OverlayState;
  private snapX = 0;

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
      this.resizeForMembers(state.members.filter((m) => !m.isEmptySlot).length);
    }
  }

  private resizeForMembers(onlineCount: number): void {
    if (!this.window || this.window.isDestroyed()) return;

    const avatarSize = 40;
    const gap = 6;
    const padding = 8;
    const count = Math.max(1, Math.min(onlineCount, 5));
    const width = padding * 2 + count * avatarSize + Math.max(0, count - 1) * gap;
    const height = padding * 2 + avatarSize;

    const bounds = this.window.getBounds();
    this.window.setBounds({
      x: this.snapX,
      y: bounds.y,
      width: Math.max(56, width),
      height: Math.max(56, height),
    });
  }

  private create(): void {
    const boundsPath = path.join(app.getPath("userData"), "overlay-bounds.json");
    let savedY: number | undefined;
    try {
      if (existsSync(boundsPath)) {
        const saved = JSON.parse(readFileSync(boundsPath, "utf8")) as { y?: number };
        savedY = saved.y;
      }
    } catch {
      // ignore
    }

    const workArea = screen.getPrimaryDisplay().workArea;
    this.snapX = workArea.x + 4;
    const y = savedY ?? workArea.y + Math.round((workArea.height - 56) / 2);

    const window = new BrowserWindow({
      width: 56,
      height: 56,
      x: this.snapX,
      y,
      minWidth: 56,
      minHeight: 56,
      maxWidth: 280,
      maxHeight: 64,
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
        window.setBounds({ x: this.snapX, y: bounds.y, width: bounds.width, height: bounds.height });
        writeFileSync(boundsPath, JSON.stringify({ y: bounds.y }), "utf8");
      } catch {
        // ignore
      }
    };
    window.on("moved", saveBounds);
    window.webContents.once("did-finish-load", () => {
      if (this.state) {
        window.webContents.send(IPC_CHANNELS.overlay.state, this.state);
        this.resizeForMembers(this.state.members.filter((m) => !m.isEmptySlot).length);
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
