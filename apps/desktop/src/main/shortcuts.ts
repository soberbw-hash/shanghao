import { globalShortcut, type BrowserWindow } from "electron";
import { uIOhook, type UiohookMouseEvent } from "uiohook-napi";

import {
  IPC_CHANNELS,
  isQuickMessageShortcutSlot,
  type RendererLogPayload,
} from "@private-voice/shared";

import { sendToWindow } from "./safe-web-contents";
import { PhoneShortcut } from "./phone-shortcut";
import { PhoneInputMonitor } from "./phone-input-monitor";

type ShortcutOwner = "mute" | "recording-marker" | "push-to-talk" | `quick-message:${number}`;

type ShortcutBindingSnapshot = {
  applied: string | null;
  observed: "active" | "suspended" | "missing" | "inactive";
};

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
  pressed?: boolean;
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
  private mouseHookSuppressed = false;
  private phoneBinding?: PhoneShortcut;
  private phoneAccelerator = "";
  private phoneNativeReady = false;
  private phoneRawInputReady = false;
  private lastPhoneHookAt = 0;
  private readonly phoneInput = new PhoneInputMonitor(
    (ready, rawInput) => {
      this.phoneNativeReady = ready;
      this.phoneRawInputReady = ready && rawInput === true;
    },
    (sampledAt) => sampledAt > this.lastPhoneHookAt,
  );
  private readonly phoneKeyDown = (event: Parameters<PhoneShortcut["keyDown"]>[0]) => {
    if (this.phoneBinding?.keyDown(event)) this.lastPhoneHookAt = Date.now();
  };
  private readonly phoneKeyUp = (event: Parameters<PhoneShortcut["keyUp"]>[0]) => {
    if (this.phoneBinding?.keyUp(event)) this.lastPhoneHookAt = Date.now();
  };

  private inspectBinding(owner: ShortcutOwner, accelerator?: string): ShortcutBindingSnapshot {
    if (!accelerator) return { applied: null, observed: "inactive" };
    const mouse = parseMouseShortcut(accelerator);
    if (mouse) {
      if (this.mouseBindings.get(mouse.accelerator)?.owner !== owner) {
        return { applied: accelerator, observed: "missing" };
      }
      return {
        applied: accelerator,
        observed: this.mouseHookStarted
          ? "active"
          : this.mouseHookSuppressed
            ? "suspended"
            : "missing",
      };
    }
    try {
      return {
        applied: accelerator,
        observed: globalShortcut.isRegistered(accelerator) ? "active" : "missing",
      };
    } catch {
      return { applied: accelerator, observed: "missing" };
    }
  }

  getRuntimeSnapshot() {
    return {
      capturedAt: new Date().toISOString(),
      mouseHook: { started: this.mouseHookStarted, suppressed: this.mouseHookSuppressed },
      mute: this.inspectBinding("mute", this.currentMuteShortcut),
      recordingMarker: this.inspectBinding("recording-marker", this.currentRecordingMarkerShortcut),
      pushToTalkMouse: this.inspectBinding("push-to-talk", this.currentPushToTalkShortcut),
      quickMessages: [...this.currentQuickMessageShortcuts.entries()]
        .sort(([left], [right]) => left - right)
        .map(([slot, accelerator]) => ({
          slot,
          ...this.inspectBinding(`quick-message:${slot}`, accelerator),
        })),
      phone: {
        applied: this.phoneAccelerator || null,
        observed: this.phoneBinding
          ? this.phoneNativeReady || this.mouseHookStarted
            ? "active"
            : "missing"
          : "inactive",
        inputPath: this.phoneNativeReady ? "hook+windows-native" : "hook",
        nativeInputReady: this.phoneNativeReady,
        rawInputReady: this.phoneRawInputReady,
      },
    };
  }

  private conflictsWithPhone(accelerator: string): boolean {
    return Boolean(
      accelerator && accelerator.toLowerCase() === this.phoneAccelerator.toLowerCase(),
    );
  }

  configurePhone(
    shortcut: string,
    trigger: "hold" | "toggle",
    change: (active?: boolean) => void,
  ): void {
    const normalized = shortcut.trim();
    const next = normalized ? PhoneShortcut.parse(normalized, trigger, change) : undefined;
    const mouse = parseMouseShortcut(normalized);
    // The native hook owns both key-down and key-up for phone mode. Do not
    // additionally reserve an Electron accelerator with a different key grammar.
    if (mouse && this.mouseBindings.has(mouse.accelerator)) throw new Error("快捷键已被占用");
    if (
      normalized &&
      [
        this.currentMuteShortcut,
        this.currentRecordingMarkerShortcut,
        this.currentPushToTalkShortcut,
        ...this.currentQuickMessageShortcuts.values(),
      ].some((key) => key?.toLowerCase() === normalized.toLowerCase())
    )
      throw new Error("该快捷键已用于上号的其他功能，请先更改原快捷键");
    const previous = this.phoneBinding;
    // Subscribe before starting the native hook. `start()` begins delivering
    // events immediately, so registering listeners afterward can lose the
    // first key-down (notably when the user presses the shortcut as the app
    // or a replacement binding is initializing).
    if (next && !previous) {
      uIOhook.on("keydown", this.phoneKeyDown);
      uIOhook.on("keyup", this.phoneKeyUp);
    }
    this.phoneBinding = next;
    if (next && !this.ensureMouseHook() && next.virtualKey === undefined) {
      this.phoneBinding = previous;
      if (!previous) {
        uIOhook.off("keydown", this.phoneKeyDown);
        uIOhook.off("keyup", this.phoneKeyUp);
      }
      next.reset();
      throw new Error("全局快捷键监听启动失败");
    }
    if (previous) {
      if (!next) {
        uIOhook.off("keydown", this.phoneKeyDown);
        uIOhook.off("keyup", this.phoneKeyUp);
      }
      previous.reset();
    }
    this.phoneAccelerator = normalized;
    this.phoneInput.configure(next);
    this.stopMouseHookIfUnused();
  }

  resetPhonePress(): void {
    this.phoneBinding?.reset();
  }

  constructor(
    private readonly windowProvider: () => BrowserWindow | null,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  private readonly handleMouseDown = (event: UiohookMouseEvent): void => {
    if (this.phoneBinding?.mouseDown(event)) this.lastPhoneHookAt = Date.now();
    for (const binding of this.mouseBindings.values()) {
      if (!matchesMouseShortcut(event, binding) || binding.pressed) continue;
      if (binding.onRelease) binding.pressed = true;
      binding.onPress();
    }
  };

  private readonly handleMouseUp = (event: UiohookMouseEvent): void => {
    if (this.phoneBinding?.mouseUp(event)) this.lastPhoneHookAt = Date.now();
    for (const binding of this.mouseBindings.values()) {
      // The pressed button owns release even if Ctrl/Alt was released first.
      if (Number(event.button) === binding.button) this.releaseMouseBinding(binding);
    }
  };

  private releaseMouseBinding(binding: MouseShortcutBinding): void {
    if (!binding.pressed) return;
    binding.pressed = false;
    binding.onRelease?.();
  }

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
    if (
      !this.mouseHookStarted ||
      this.phoneBinding ||
      (!this.mouseHookSuppressed && this.mouseBindings.size > 0)
    )
      return;
    this.stopMouseHook();
  }

  private stopMouseHook(): void {
    if (!this.mouseHookStarted) return;
    for (const binding of this.mouseBindings.values()) this.releaseMouseBinding(binding);
    uIOhook.off("mousedown", this.handleMouseDown);
    uIOhook.off("mouseup", this.handleMouseUp);
    try {
      uIOhook.stop();
    } catch {
      // The native hook may already be stopped during process shutdown.
    }
    this.mouseHookStarted = false;
  }

  /**
   * uIOhook receives every native mouse event, including high-frequency
   * movement events. Pause that global hook while a detected game owns the
   * foreground input path; keyboard global shortcuts remain available.
   */
  setMouseHookSuppressed(suppressed: boolean): void {
    if (this.mouseHookSuppressed === suppressed) return;
    this.mouseHookSuppressed = suppressed;
    if (suppressed) {
      if (this.phoneBinding) return; // Global key-up must remain alive during games.
      this.stopMouseHook();
      return;
    }
    if (this.mouseBindings.size > 0) {
      this.ensureMouseHook();
    }
  }

  private removeBinding(owner: ShortcutOwner, accelerator?: string): void {
    if (!accelerator) return;
    const mouseBinding = parseMouseShortcut(accelerator);
    if (mouseBinding) {
      const current = this.mouseBindings.get(mouseBinding.accelerator);
      if (current?.owner === owner) {
        this.releaseMouseBinding(current);
        this.mouseBindings.delete(mouseBinding.accelerator);
      }
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
    if (parseMouseShortcut(this.phoneAccelerator)?.accelerator === parsed.accelerator) return false;
    if (this.mouseBindings.has(parsed.accelerator)) return false;
    const binding: MouseShortcutBinding = { ...parsed, owner, onPress, onRelease };
    this.mouseBindings.set(parsed.accelerator, binding);
    if (this.mouseHookSuppressed) return true;
    if (this.ensureMouseHook()) return true;
    this.mouseBindings.delete(parsed.accelerator);
    this.stopMouseHookIfUnused();
    return false;
  }

  async configureGlobalMute(accelerator: string): Promise<boolean> {
    if (this.conflictsWithPhone(accelerator.trim())) return false;
    const previous = this.currentMuteShortcut;
    const normalized = accelerator.trim();
    if (previous === normalized) return true;
    if (!normalized) {
      this.removeBinding("mute", previous);
      this.currentMuteShortcut = undefined;
      return false;
    }
    if (parseMouseShortcut(normalized)) {
      const registered = this.addMouseBinding("mute", normalized, () => {
        sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.muteTriggered);
      });
      if (registered) {
        this.removeBinding("mute", previous);
        this.currentMuteShortcut = normalized;
      }
      return registered;
    }
    try {
      const registered = globalShortcut.register(normalized, () => {
        sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.muteTriggered);
      });
      if (!registered) throw new Error(`Failed to register global shortcut: ${normalized}`);
      this.removeBinding("mute", previous);
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
    if (this.conflictsWithPhone(accelerator.trim())) return false;
    const previous = this.currentRecordingMarkerShortcut;
    const normalized = accelerator.trim();
    if (previous === normalized) return true;
    if (!normalized) {
      this.removeBinding("recording-marker", previous);
      this.currentRecordingMarkerShortcut = undefined;
      return false;
    }
    if (parseMouseShortcut(normalized)) {
      const registered = this.addMouseBinding("recording-marker", normalized, () => {
        sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.recordingMarkerTriggered);
      });
      if (registered) {
        this.removeBinding("recording-marker", previous);
        this.currentRecordingMarkerShortcut = normalized;
      }
      return registered;
    }
    try {
      const registered = globalShortcut.register(normalized, () => {
        sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.recordingMarkerTriggered);
      });
      if (!registered) {
        throw new Error(`Failed to register recording marker shortcut: ${normalized}`);
      }
      this.removeBinding("recording-marker", previous);
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
    if (enabled && this.conflictsWithPhone(accelerator.trim())) return false;
    const previous = this.currentPushToTalkShortcut;
    const normalized = accelerator.trim();
    if (!enabled || !normalized || !parseMouseShortcut(normalized)) {
      this.removeBinding("push-to-talk", previous);
      this.currentPushToTalkShortcut = undefined;
      return true;
    }
    if (previous === normalized) return true;
    const registered = this.addMouseBinding(
      "push-to-talk",
      normalized,
      () => sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.pushToTalkState, true),
      () => sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.pushToTalkState, false),
    );
    if (registered) {
      this.removeBinding("push-to-talk", previous);
      this.currentPushToTalkShortcut = normalized;
    }
    return registered;
  }

  async configureQuickMessage(slot: number, accelerator: string): Promise<boolean> {
    if (!isQuickMessageShortcutSlot(slot)) return false;
    if (this.conflictsWithPhone(accelerator.trim())) return false;
    const owner = `quick-message:${slot}` as const;
    const previous = this.currentQuickMessageShortcuts.get(slot);
    const normalized = accelerator.trim();
    if (previous === normalized) return true;
    if (!normalized) {
      this.removeBinding(owner, previous);
      this.currentQuickMessageShortcuts.delete(slot);
      return false;
    }
    const send = () =>
      sendToWindow(this.windowProvider(), IPC_CHANNELS.shortcuts.quickMessageTriggered, slot);
    if (parseMouseShortcut(normalized)) {
      const registered = this.addMouseBinding(owner, normalized, send);
      if (registered) {
        this.removeBinding(owner, previous);
        this.currentQuickMessageShortcuts.set(slot, normalized);
      }
      return registered;
    }
    try {
      const registered = globalShortcut.register(normalized, send);
      if (!registered) throw new Error(`Failed to register quick message shortcut: ${normalized}`);
      this.removeBinding(owner, previous);
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
    this.configurePhone("", "hold", () => undefined);
    globalShortcut.unregisterAll();
    this.stopMouseHook();
    this.mouseBindings.clear();
    this.currentMuteShortcut = undefined;
    this.currentRecordingMarkerShortcut = undefined;
    this.currentPushToTalkShortcut = undefined;
    this.currentQuickMessageShortcuts.clear();
  }
}
