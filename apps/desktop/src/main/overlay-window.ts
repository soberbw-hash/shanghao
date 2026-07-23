import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { app, BrowserWindow, screen } from "electron";

import { IPC_CHANNELS, type OverlayState } from "@private-voice/shared";

import { sendToWindow } from "./safe-web-contents";

const devServerUrl = "http://127.0.0.1:5173";
const OVERLAY_AVATAR_SIZE = 24;
const OVERLAY_GAP = 3;
const OVERLAY_PADDING_X = 5;
const OVERLAY_STATUS_WIDTH = 18;
const OVERLAY_SHADOW_MARGIN = 0;
const OVERLAY_PILL_HEIGHT = 32;
const OVERLAY_HEIGHT = OVERLAY_PILL_HEIGHT + OVERLAY_SHADOW_MARGIN * 2;
const OVERLAY_MIN_PILL_WIDTH = 64;
const OVERLAY_MIN_WIDTH = OVERLAY_MIN_PILL_WIDTH + OVERLAY_SHADOW_MARGIN * 2;

export class OverlayWindowController {
  private window: BrowserWindow | null = null;
  private state?: OverlayState;
  private snapX = 0;

  show(): boolean {
    if (!this.window || this.window.isDestroyed()) {
      this.create();
    }
    return true;
  }

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
      sendToWindow(this.window, IPC_CHANNELS.overlay.state, state);
      this.resizeForMembers(state.members.filter((m) => !m.isEmptySlot).length);
    }
  }

  private resizeForMembers(onlineCount: number): void {
    if (!this.window || this.window.isDestroyed()) return;

    const count = Math.max(1, Math.min(onlineCount, 5));
    const pillWidth =
      OVERLAY_PADDING_X * 2 +
      count * OVERLAY_AVATAR_SIZE +
      Math.max(0, count - 1) * OVERLAY_GAP +
      OVERLAY_GAP +
      OVERLAY_STATUS_WIDTH;
    const width = Math.max(OVERLAY_MIN_WIDTH, pillWidth + OVERLAY_SHADOW_MARGIN * 2);
    const height = OVERLAY_HEIGHT;

    const bounds = this.window.getBounds();
    this.window.setBounds({
      x: this.snapX,
      y: bounds.y,
      width,
      height,
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
    this.snapX = workArea.x + 6;
    const y = savedY ?? workArea.y + Math.round((workArea.height - OVERLAY_HEIGHT) / 2);

    const window = new BrowserWindow({
      width: OVERLAY_MIN_WIDTH,
      height: OVERLAY_HEIGHT,
      x: this.snapX,
      y,
      minWidth: OVERLAY_MIN_WIDTH,
      minHeight: OVERLAY_HEIGHT,
      maxWidth: 172,
      maxHeight: OVERLAY_HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      show: false,
      closable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: path.join(__dirname, "../preload/overlay.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    this.window = window;
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setMovable(false);
    window.setIgnoreMouseEvents(true, { forward: true });

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
        window.setBounds({
          x: this.snapX,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
        writeFileSync(boundsPath, JSON.stringify({ y: bounds.y }), "utf8");
      } catch {
        // ignore
      }
    };
    window.on("moved", saveBounds);
    window.webContents.once("did-finish-load", () => {
      if (this.state) {
        sendToWindow(window, IPC_CHANNELS.overlay.state, this.state);
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
