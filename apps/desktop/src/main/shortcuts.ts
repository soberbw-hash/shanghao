import { globalShortcut, type BrowserWindow } from "electron";
import { uIOhook, type UiohookMouseEvent } from "uiohook-napi";

import { IPC_CHANNELS, type RendererLogPayload } from "@private-voice/shared";

import { sendToWindow } from "./safe-web-contents";

type ShortcutOwner = "mute" | "recording-marker" | "push-to-talk" | `quick-message:${number}`;

type MouseShortcutBinding = {
  owner: ShortcutOwner;
  accelerator: string;
  button: 4 | 5;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  onPress: () => void;
  onRelease?: () => void;
};

const mouseShortcutAliases: Record<string, 4 | 5> = {
  mouse4: 4,
  mouse5: 5,
  xbutton1: 4,
  xbutton2: 5,
};

const mouseModifierNames = new Set([
  "ctrl",
  "control",
  "meta",
  "command",
  "cmd",
  "shift",
  "alt",
  "option",
]);

const parseMouseShortcut = (accelerator: string): MouseShortcutBinding | undefined => {
  const tokens = accelerator
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
  const mouseToken = tokens.find((token) => mouseShortcutAliases[token]);
  if (
    !mouseToken ||
    tokens.some((token) => !mouseModifierNames.has(token) && token !== mouseToken)
  ) {
    return undefined;
  }
  const button = mouseShortcutAliases[mouseToken];
  if (!button) return undefined;

  const modifiers = {
    ctrl: tokens.includes("ctrl") || tokens.includes("control"),
    meta: tokens.includes("meta") || tokens.includes("command") || tokens.includes("cmd"),
    shift: tokens.includes("shift"),
    alt: tokens.includes("alt") || tokens.includes("option"),
  };
  const modifierTokens = [
    modifiers.ctrl ? "Ctrl" : "",
    modifiers.meta ? "Meta" : "",
    modifiers.shift ? "Shift" : "",
    modifiers.alt ? "Alt" : "",
  ].filter(Boolean);

  return {
    owner: "mute",
    accelerator: [...modifierTokens, `Mouse${button}`].join("+"),
    button,
    ...modifiers,
    onPress: () => undefined,
  };
};

const matchesMouseShortcut = (event: UiohookMouseEvent, binding: MouseShortcutBinding): boolean =>
  Number(event.button) === binding.button &&
  event.ctrlKey === binding.ctrl &&
  event.metaKey === binding.meta &&
  event.shiftKey === binding.shift &&
  event.altKey === binding.alt;

export class ShortcutController {
  private currentMuteShortcut?: string;
  private currentRecordingMarkerShortcut?: string;
  private currentPushToTalkShortcut?: string;
  private readonly currentQuickMessageShortcuts = new Map<number, string>();
  private readonly mouseBindings = new Map<string, MouseShortcutBinding>();
  private mouseHookStarted = false;

  constructor(
    private readonly windowProvider: () => BrowserWindow | null,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  private readonly handleMouseDown = (event: UiohookMouseEvent): void => {
    for (const binding of this.mouseBindings.values()) {
      if (matchesMouseShortcut(event, binding)) binding.onPress();
    }
  };

  private readonly handleMouseUp = (event: UiohookMouseEvent): void => {
    for (const binding of this.mouseBindings.values()) {
      if (matchesMouseShortcut(event, binding)) binding.onRelease?.();
    }
  };

  private ensureMouseHook(): boolean {
    if (this.mouseHookStarted) return true;
    try {
      uIOhook.on("mousedown", this.handleMouseDown);
      uIOhook.on("mouseup", this.handleMouseUp);
      uIOhook.start();
      this.mouseHookStarted = true;
      return true;
    } catch (error) {
      uIOhook.off("mousedown", this.handleMouseDown);
      uIOhook.off("mouseup", this.handleMouseUp);
      void this.writeLog?.({
        category: "app",
        level: "warn",
        message: "mouse shortcut hook start failed",
        context: { error: error instanceof Error ? error.message : String(error) },
      });
      return false;
    }
  }

  private stopMouseHookIfUnused(): void {
    if (this.mouseBindings.size > 0 || !this.mouseHookStarted) return;
    uIOhook.off("mousedown", this.handleMouseDown);
    uIOhook.off("mouseup", this.handleMouseUp);
    try {
      uIOhook.stop();
    } catch {
      // The native hook may already be stopped during process shutdown.
    }
    this.mouseHookStarted = false;
  }

  private removeBinding(owner: ShortcutOwner, accelerator?: string): void {
    if (!accelerator) return;
    const mouseBinding = parseMouseShortcut(accelerator);
    if (mouseBinding) {
      const current = this.mouseBindings.get(mouseBinding.accelerator);
      if (current?.owner === owner) this.mouseBindings.delete(mouseBinding.accelerator);
    } else {
      globalShortcut.unregister(accelerator);
    }
    this.stopMouseHookIfUnused();
  }

  private addMouseBinding(
    owner: ShortcutOwner,
    accelerator: string,
    onPress: () => void,
    onRelease?: () => void,
  ): boolean {
    const parsed = parseMouseShortcut(accelerator);
    if (!parsed) return false;
    if (this.mouseBindings.has(parsed.accelerator)) return false;
    const binding: MouseShortcutBinding = { ...parsed, owner, onPress, onRelease };
    this.mouseBindings.set(parsed.accelerator, binding);
    if (this.ensureMouseHook()) return true;
    this.mouseBindings.delete(parsed.accelerator);
    this.stopMouseHookIfUnused();
    return false;
  }

  async configureGlobalMute(accelerator: string): Promise<boolean> {
    this.removeBinding("mute", this.currentMuteShortcut);
    this.currentMuteShortcut = undefined;
    const normalized = accelerator.trim();
    if (!normalized) return false;
    if (parseMouseShortcut(normalized)) {
      const registered = this.addMouseBinding("mute", normalized, () => {
        sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.muteTriggered);
      });
      if (registered) this.currentMuteShortcut = normalized;
      return registered;
    }
    try {
      const registered = globalShortcut.register(normalized, () => {
        sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.muteTriggered);
      });
      if (!registered) throw new Error(`Failed to register global shortcut: ${normalized}`);
      this.currentMuteShortcut = normalized;
      return true;
    } catch (error) {
      await this.writeLog?.({
        category: "app",
        level: "warn",
        message: "shortcut register fail",
        context: {
          accelerator: normalized,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  async configureRecordingMarker(accelerator: string): Promise<boolean> {
    this.removeBinding("recording-marker", this.currentRecordingMarkerShortcut);
    this.currentRecordingMarkerShortcut = undefined;
    const normalized = accelerator.trim();
    if (!normalized) return false;
    if (parseMouseShortcut(normalized)) {
      const registered = this.addMouseBinding("recording-marker", normalized, () => {
        sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.recordingMarkerTriggered);
      });
      if (registered) this.currentRecordingMarkerShortcut = normalized;
      return registered;
    }
    try {
      const registered = globalShortcut.register(normalized, () => {
        sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.recordingMarkerTriggered);
      });
      if (!registered) {
        throw new Error(`Failed to register recording marker shortcut: ${normalized}`);
      }
      this.currentRecordingMarkerShortcut = normalized;
      return true;
    } catch (error) {
      await this.writeLog?.({
        category: "recording",
        level: "warn",
        message: "recording marker shortcut register failed",
        context: {
          accelerator: normalized,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  async configurePushToTalk(accelerator: string, enabled: boolean): Promise<boolean> {
    this.removeBinding("push-to-talk", this.currentPushToTalkShortcut);
    this.currentPushToTalkShortcut = undefined;
    const normalized = accelerator.trim();
    if (!enabled || !normalized || !parseMouseShortcut(normalized)) return true;
    const registered = this.addMouseBinding(
      "push-to-talk",
      normalized,
      () => sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.pushToTalkState, true),
      () => sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.pushToTalkState, false),
    );
    if (registered) this.currentPushToTalkShortcut = normalized;
    return registered;
  }

  async configureQuickMessage(slot: number, accelerator: string): Promise<boolean> {
    const owner = `quick-message:${slot}` as const;
    const previous = this.currentQuickMessageShortcuts.get(slot);
    const normalized = accelerator.trim();
    if (previous === normalized) return true;
    this.removeBinding(owner, previous);
    this.currentQuickMessageShortcuts.delete(slot);
    if (!normalized) return false;
    const send = () =>
      sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.quickMessageTriggered, slot);
    if (parseMouseShortcut(normalized)) {
      const registered = this.addMouseBinding(owner, normalized, send);
      if (registered) this.currentQuickMessageShortcuts.set(slot, normalized);
      return registered;
    }
    try {
      const registered = globalShortcut.register(normalized, send);
      if (!registered) throw new Error(`Failed to register quick message shortcut: ${normalized}`);
      this.currentQuickMessageShortcuts.set(slot, normalized);
      return true;
    } catch (error) {
      await this.writeLog?.({
        category: "app",
        level: "warn",
        message: "quick message shortcut register failed",
        context: {
          slot,
          accelerator: normalized,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  dispose(): void {
    globalShortcut.unregisterAll();
    this.mouseBindings.clear();
    this.stopMouseHookIfUnused();
  }
}
