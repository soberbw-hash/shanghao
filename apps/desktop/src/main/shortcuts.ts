import { globalShortcut, type BrowserWindow } from "electron";
import {
  UiohookKey,
  uIOhook,
  type UiohookKeyboardEvent,
} from "uiohook-napi";

import { IPC_CHANNELS, type RendererLogPayload } from "@private-voice/shared";

import { sendToWindow } from "./safe-web-contents";

export class ShortcutController {
  private currentMuteShortcut?: string;
  private currentRecordingMarkerShortcut?: string;
  private pushToTalkBinding?: {
    keycode: number;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
  };
  private pushToTalkPressed = false;
  private globalHookStarted = false;

  constructor(
    private readonly windowProvider: () => BrowserWindow | null,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  private readonly handleGlobalKeyDown = (event: UiohookKeyboardEvent): void => {
    if (
      this.pushToTalkPressed ||
      !this.matchesPushToTalkBinding(event)
    ) {
      return;
    }
    this.pushToTalkPressed = true;
    sendToWindow(
      this.windowProvider(),
      IPC_CHANNELS.shortcuts.pushToTalkState,
      true,
    );
  };

  private readonly handleGlobalKeyUp = (event: UiohookKeyboardEvent): void => {
    if (
      !this.pushToTalkPressed ||
      !this.pushToTalkBinding ||
      event.keycode !== this.pushToTalkBinding.keycode
    ) {
      return;
    }
    this.releasePushToTalk();
  };

  async configureGlobalMute(accelerator: string): Promise<boolean> {
    if (this.currentMuteShortcut) {
      globalShortcut.unregister(this.currentMuteShortcut);
      this.currentMuteShortcut = undefined;
    }

    if (!accelerator) {
      await this.writeLog?.({
        category: "app",
        level: "info",
        message: "shortcut register success",
        context: { accelerator: "", enabled: false },
      });
      return false;
    }

    try {
      const registered = globalShortcut.register(accelerator, () => {
        sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.muteTriggered);
      });

      if (!registered) {
        throw new Error(`Failed to register global shortcut: ${accelerator}`);
      }

      this.currentMuteShortcut = accelerator;
      await this.writeLog?.({
        category: "app",
        level: "info",
        message: "shortcut register success",
        context: { accelerator, enabled: true },
      });
      return true;
    } catch (error) {
      await this.writeLog?.({
        category: "app",
        level: "warn",
        message: "shortcut register fail",
        context: {
          accelerator,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  async configurePushToTalk(accelerator: string, enabled: boolean): Promise<boolean> {
    this.pushToTalkBinding = undefined;
    this.releasePushToTalk();
    if (!enabled || !accelerator.trim()) {
      this.stopGlobalHook();
      return false;
    }

    const binding = this.parsePushToTalkBinding(accelerator);
    if (!binding) {
      await this.writeLog?.({
        category: "app",
        level: "warn",
        message: "push-to-talk shortcut unsupported",
        context: { accelerator },
      });
      this.stopGlobalHook();
      return false;
    }

    this.pushToTalkBinding = binding;
    try {
      this.startGlobalHook();
      await this.writeLog?.({
        category: "app",
        level: "info",
        message: "push-to-talk global hook enabled",
        context: { accelerator },
      });
      return true;
    } catch (error) {
      this.pushToTalkBinding = undefined;
      await this.writeLog?.({
        category: "app",
        level: "warn",
        message: "push-to-talk global hook failed",
        context: {
          accelerator,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  async configureRecordingMarker(accelerator: string): Promise<boolean> {
    if (this.currentRecordingMarkerShortcut) {
      globalShortcut.unregister(this.currentRecordingMarkerShortcut);
      this.currentRecordingMarkerShortcut = undefined;
    }
    if (!accelerator.trim()) {
      return false;
    }
    try {
      const registered = globalShortcut.register(accelerator, () => {
        sendToWindow(
          this.windowProvider(),
          IPC_CHANNELS.shortcuts.recordingMarkerTriggered,
        );
      });
      if (!registered) {
        throw new Error(`Failed to register recording marker shortcut: ${accelerator}`);
      }
      this.currentRecordingMarkerShortcut = accelerator;
      return true;
    } catch (error) {
      await this.writeLog?.({
        category: "recording",
        level: "warn",
        message: "recording marker shortcut register failed",
        context: {
          accelerator,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  private parsePushToTalkBinding(accelerator: string) {
    const tokens = accelerator
      .split("+")
      .map((token) => token.trim())
      .filter(Boolean);
    const modifiers = new Set(tokens.map((token) => token.toLowerCase()));
    const keyToken = tokens.find(
      (token) =>
        !["ctrl", "control", "alt", "option", "shift", "meta", "cmd", "command"].includes(
          token.toLowerCase(),
        ),
    );
    if (!keyToken) {
      return undefined;
    }
    const normalizedKey =
      keyToken.length === 1 ? keyToken.toUpperCase() : keyToken;
    const keycode = UiohookKey[normalizedKey as keyof typeof UiohookKey];
    if (typeof keycode !== "number") {
      return undefined;
    }
    return {
      keycode,
      ctrlKey: modifiers.has("ctrl") || modifiers.has("control"),
      altKey: modifiers.has("alt") || modifiers.has("option"),
      shiftKey: modifiers.has("shift"),
      metaKey:
        modifiers.has("meta") ||
        modifiers.has("cmd") ||
        modifiers.has("command"),
    };
  }

  private matchesPushToTalkBinding(event: UiohookKeyboardEvent): boolean {
    const binding = this.pushToTalkBinding;
    return Boolean(
      binding &&
        event.keycode === binding.keycode &&
        event.ctrlKey === binding.ctrlKey &&
        event.altKey === binding.altKey &&
        event.shiftKey === binding.shiftKey &&
        event.metaKey === binding.metaKey,
    );
  }

  private startGlobalHook(): void {
    if (this.globalHookStarted) {
      return;
    }
    uIOhook.on("keydown", this.handleGlobalKeyDown);
    uIOhook.on("keyup", this.handleGlobalKeyUp);
    uIOhook.start();
    this.globalHookStarted = true;
  }

  private stopGlobalHook(): void {
    if (!this.globalHookStarted) {
      return;
    }
    uIOhook.off("keydown", this.handleGlobalKeyDown);
    uIOhook.off("keyup", this.handleGlobalKeyUp);
    uIOhook.stop();
    this.globalHookStarted = false;
  }

  private releasePushToTalk(): void {
    if (!this.pushToTalkPressed) {
      return;
    }
    this.pushToTalkPressed = false;
    sendToWindow(
      this.windowProvider(),
      IPC_CHANNELS.shortcuts.pushToTalkState,
      false,
    );
  }

  dispose(): void {
    this.releasePushToTalk();
    this.stopGlobalHook();
    globalShortcut.unregisterAll();
  }
}
