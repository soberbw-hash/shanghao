import path from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { app, BrowserWindow, screen } from "electron";

import { IPC_CHANNELS, type OverlayState } from "@private-voice/shared";

import {
  centerOverlayTop,
  clampOverlayTop,
  isPointInsideOverlay,
  resizeOverlayKeepingTop,
  snapOverlayTop,
} from "./overlay-bounds";
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
  private boundsPath = "";
  private boundsSaveTimer?: NodeJS.Timeout;
  private hoverPollTimer?: NodeJS.Timeout;
  private cursorInside = false;
  private rendererInteractionLock = false;
  private mouseEventsEnabled = false;

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
    this.persistBoundsNow();
    this.stopHoverTracking();
    this.window?.destroy();
    this.window = null;
  }

  setInteractive(interactive: boolean): void {
    this.rendererInteractionLock = interactive;
    this.applyMouseEventMode();
  }

  moveTo(desiredTopY: number): void {
    if (!this.window || this.window.isDestroyed() || !Number.isFinite(desiredTopY)) return;
    const bounds = this.window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const snappedY = snapOverlayTop(desiredTopY, bounds.height, display.workArea, this.gridSize);
    if (bounds.x === this.snapX && bounds.y === snappedY) return;
    this.window.setPosition(this.snapX, snappedY, false);
    this.scheduleBoundsSave();
  }

  resetPosition(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const y = centerOverlayTop(bounds.height, display.workArea);
    if (bounds.x === this.snapX && bounds.y === y) return;
    this.window.setPosition(this.snapX, y, false);
    this.scheduleBoundsSave();
  }

  reconcileDisplayBounds(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    const display = screen.getDisplayMatching(bounds);
    this.snapX = display.workArea.x + 6;
    const nextY = clampOverlayTop(bounds.y, bounds.height, display.workArea);
    this.window.setPosition(this.snapX, nextY, false);
    this.window.setAlwaysOnTop(true, "screen-saver");
    this.scheduleBoundsSave();
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
    const nextBounds = resizeOverlayKeepingTop(
      bounds,
      height,
      display.workArea,
      this.snapX,
      OVERLAY_WIDTH,
    );
    if (
      bounds.x === nextBounds.x &&
      bounds.y === nextBounds.y &&
      bounds.width === nextBounds.width &&
      bounds.height === nextBounds.height
    ) {
      return;
    }
    this.window.setBounds(nextBounds, false);
    if (bounds.y !== nextBounds.y) this.scheduleBoundsSave();
  }

  private create(): void {
    this.boundsPath = path.join(app.getPath("userData"), "overlay-bounds.json");
    let savedY: number | undefined;
    try {
      if (existsSync(this.boundsPath)) {
        const saved = JSON.parse(readFileSync(this.boundsPath, "utf8")) as { y?: number };
        if (typeof saved.y === "number" && Number.isFinite(saved.y)) savedY = saved.y;
      }
    } catch {
      // ignore
    }

    const workArea = screen.getPrimaryDisplay().workArea;
    this.snapX = workArea.x + 6;
    const y =
      savedY === undefined
        ? centerOverlayTop(OVERLAY_MIN_HEIGHT, workArea)
        : clampOverlayTop(savedY, OVERLAY_MIN_HEIGHT, workArea);

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
    this.cursorInside = false;
    this.rendererInteractionLock = false;
    this.mouseEventsEnabled = false;
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.setMovable(false);
    window.setIgnoreMouseEvents(true, { forward: true });

    window.on("closed", () => {
      this.stopHoverTracking();
      if (this.window === window) {
        this.window = null;
      }
    });

    window.on("blur", () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.setAlwaysOnTop(true, "screen-saver");
      }
    });

    window.webContents.once("did-finish-load", () => {
      if (this.state) {
        sendToWindow(window, IPC_CHANNELS.overlay.state, this.state);
        this.resizeForMembers(this.state.members.filter((m) => !m.isEmptySlot).length);
      }
      window.showInactive();
      this.startHoverTracking();
    });

    if (!app.isPackaged) {
      void window.loadURL(`${devServerUrl}?overlay=1`);
    } else {
      void window.loadFile(path.join(__dirname, "../../dist/index.html"), {
        query: { overlay: "1" },
      });
    }
  }

  private applyMouseEventMode(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const shouldEnable = this.cursorInside || this.rendererInteractionLock;
    if (shouldEnable === this.mouseEventsEnabled) return;
    this.mouseEventsEnabled = shouldEnable;
    this.window.setIgnoreMouseEvents(!shouldEnable, { forward: true });
  }

  private startHoverTracking(): void {
    this.stopHoverTracking();
    const updateHoverState = () => {
      if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return;
      const isInside = isPointInsideOverlay(screen.getCursorScreenPoint(), this.window.getBounds());
      if (isInside === this.cursorInside) return;
      this.cursorInside = isInside;
      this.applyMouseEventMode();
      sendToWindow(this.window, IPC_CHANNELS.overlay.hoverState, isInside);
    };
    updateHoverState();
    this.hoverPollTimer = setInterval(updateHoverState, 80);
  }

  private stopHoverTracking(): void {
    if (this.hoverPollTimer) clearInterval(this.hoverPollTimer);
    this.hoverPollTimer = undefined;
    this.cursorInside = false;
    this.rendererInteractionLock = false;
    if (this.window && !this.window.isDestroyed()) {
      this.mouseEventsEnabled = false;
      this.window.setIgnoreMouseEvents(true, { forward: true });
    }
  }

  private scheduleBoundsSave(): void {
    if (this.boundsSaveTimer) clearTimeout(this.boundsSaveTimer);
    this.boundsSaveTimer = setTimeout(() => {
      this.boundsSaveTimer = undefined;
      this.persistBoundsNow();
    }, 120);
  }

  private persistBoundsNow(): void {
    if (this.boundsSaveTimer) clearTimeout(this.boundsSaveTimer);
    this.boundsSaveTimer = undefined;
    if (!this.boundsPath || !this.window || this.window.isDestroyed()) return;
    try {
      writeFileSync(this.boundsPath, JSON.stringify({ y: this.window.getBounds().y }), "utf8");
    } catch {
      // The overlay remains usable even if its optional position preference cannot be saved.
    }
  }
}
