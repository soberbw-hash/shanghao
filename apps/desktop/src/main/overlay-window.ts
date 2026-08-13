import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { app, BrowserWindow, screen } from "electron";

import { IPC_CHANNELS, type OverlayState } from "@private-voice/shared";

import { sendToWindow } from "./safe-web-contents";

const devServerUrl = "http://127.0.0.1:5173";
const OVERLAY_WIDTH = 142;
const OVERLAY_ROW_HEIGHT = 36;
const OVERLAY_GAP = 4;
const OVERLAY_PADDING = 5;
const OVERLAY_MIN_HEIGHT = OVERLAY_ROW_HEIGHT + OVERLAY_PADDING * 2;
const OVERLAY_MAX_HEIGHT = OVERLAY_ROW_HEIGHT * 5 + OVERLAY_GAP * 4 + OVERLAY_PADDING * 2;

export class OverlayWindowController {
  private window: BrowserWindow | null = null;
  private state?: OverlayState;
  private snapX = 0;
  private readonly gridSize = 16;

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

  setInteractive(interactive: boolean): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  moveTo(desiredTopY: number): void {
    if (!this.window || this.window.isDestroyed() || !Number.isFinite(desiredTopY)) return;
    const bounds = this.window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const minY = display.workArea.y + 6;
    const maxY = display.workArea.y + display.workArea.height - bounds.height - 6;
    const snappedY = Math.round(desiredTopY / this.gridSize) * this.gridSize;
    this.window.setPosition(this.snapX, Math.max(minY, Math.min(snappedY, maxY)), false);
  }

  resetPosition(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const y = display.workArea.y + Math.round((display.workArea.height - bounds.height) / 2);
    this.window.setPosition(this.snapX, y, false);
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
    const height =
      OVERLAY_PADDING * 2 + count * OVERLAY_ROW_HEIGHT + Math.max(0, count - 1) * OVERLAY_GAP;

    const bounds = this.window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const centeredY = bounds.y + Math.round((bounds.height - height) / 2);
    const y = Math.max(
      display.workArea.y + 6,
      Math.min(centeredY, display.workArea.y + display.workArea.height - height - 6),
    );
    this.window.setBounds({
      x: this.snapX,
      y,
      width: OVERLAY_WIDTH,
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
    const y = savedY ?? workArea.y + Math.round((workArea.height - OVERLAY_MIN_HEIGHT) / 2);

    const window = new BrowserWindow({
      width: OVERLAY_WIDTH,
      height: OVERLAY_MIN_HEIGHT,
      x: this.snapX,
      y,
      minWidth: OVERLAY_WIDTH,
      minHeight: OVERLAY_MIN_HEIGHT,
      maxWidth: OVERLAY_WIDTH,
      maxHeight: OVERLAY_MAX_HEIGHT,
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
