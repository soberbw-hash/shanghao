import {
  app,
  globalShortcut,
  ipcMain,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import { access } from "node:fs/promises";
import path from "node:path";
import { IPC_CHANNELS, type BackgroundAudioState } from "@private-voice/shared";
import type { SettingsStore } from "./settings-store";
import { platformService } from "./platform/PlatformService";
import { ChatMixController } from "./chat-mix-controller";
import { ChatMixVolumeLeases } from "./chat-mix-volume-leases";
import { chatMixLeaseJournal } from "./chat-mix-lease-journal";
import { NativeChatMixBackend } from "./chat-mix-native-backend";

/** Optional ports are Main-owned, used by isolated tests; renderer cannot choose paths or PIDs. */
export function registerBackgroundAudioIpc(
  window: () => BrowserWindow | null,
  settings: SettingsStore,
  ports?: {
    executable: string;
    backend: NativeChatMixBackend;
    ownProcesses?: () => ReadonlySet<number>;
  },
): { dispose(): Promise<void> } {
  const executable =
    ports?.executable ??
    path.join(
      app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "resources"),
      "native",
      "ShangHao.ChatMix.exe",
    );
  const backend = ports?.backend ?? new NativeChatMixBackend(executable);
  let controller: ChatMixController | undefined, starting: Promise<void> | undefined;
  let available = false,
    stopped = false,
    accelerator = "",
    lastPulse = 0,
    nextStart = 0;
  let configureQueue: Promise<unknown> = Promise.resolve();
  let revision = 0,
    signature = "";
  const state = (): BackgroundAudioState => {
    const snapshot = {
      available,
      enabled: settings.getSnapshot().isBackgroundAudioBalanceEnabled === true,
      shortcut: settings.getSnapshot().backgroundAudioBalanceShortcut ?? "",
      phase: controller?.getPhase() ?? "off",
    };
    const next = JSON.stringify(snapshot);
    if (next !== signature) {
      signature = next;
      revision++;
    }
    return { ...snapshot, revision };
  };
  const check = (event: IpcMainInvokeEvent) => {
    const contents = window()?.webContents;
    if (
      stopped ||
      !contents ||
      contents.isDestroyed() ||
      contents !== event.sender ||
      event.senderFrame !== contents.mainFrame
    )
      throw Error("background_audio_forbidden");
  };
  const ensure = async () => {
    if (controller || stopped) return;
    if (starting) return starting;
    if (performance.now() < nextStart) return;
    nextStart = performance.now() + 5000;
    starting = (async () => {
      if (!platformService.isWindows) return;
      await access(executable);
      await backend.list(); // Verify the worker/COM path, not merely the presence of an EXE.
      const leases = await ChatMixVolumeLeases.open(
        backend,
        chatMixLeaseJournal(
          path.join(app.getPath("userData"), "background-audio", "volume-leases.json"),
        ),
      );
      if (stopped) return;
      controller = new ChatMixController({
        list: () => backend.list(),
        attenuate: (...args) => leases.attenuate(...args),
        restore: () => leases.restore(),
        ownProcesses:
          ports?.ownProcesses ??
          (() => new Set([process.pid, ...app.getAppMetrics().map((metric) => metric.pid)])),
      });
      available = true;
      await controller.tick();
    })().finally(() => {
      starting = undefined;
    });
    return starting;
  };
  const notify = () => {
    const contents = window()?.webContents;
    if (contents && !contents.isDestroyed())
      contents.send(IPC_CHANNELS.backgroundAudio.changed, state());
  };
  const bindShortcut = (next: string): boolean => {
    if (next) return false;
    if (next === accelerator) return true;
    if (next && !/^(?:CommandOrControl|Control|Ctrl)\+(?:Shift|Alt)\+F(?:[1-9]|1[0-2])$/.test(next))
      return false;
    if (next) {
      let registered = false;
      try {
        if (!globalShortcut.isRegistered(next))
          registered = globalShortcut.register(next, () => {
            if (stopped) return;
            void configure({}, true)
              .then(notify)
              .catch(() => undefined);
          });
      } catch {
        return false;
      }
      if (!registered) return false;
    }
    if (accelerator) globalShortcut.unregister(accelerator);
    accelerator = next;
    return true;
  };
  const configure = (
    patch: { enabled?: boolean; shortcut?: string },
    toggle = false,
  ): Promise<BackgroundAudioState> => {
    const operation = configureQueue.then(async () => {
      if (stopped) throw Error("background_audio_closed");
      await ensure().catch(() => undefined);
      if (stopped) throw Error("background_audio_closed");
      const enabled = toggle
        ? !settings.getSnapshot().isBackgroundAudioBalanceEnabled
        : patch.enabled;
      // A missing/recovering component must not trap an existing preference in the on state.
      if (!available && (enabled === true || patch.shortcut))
        throw Error("background_audio_unavailable");
      const previous = accelerator;
      if (patch.shortcut !== undefined && !bindShortcut(patch.shortcut))
        throw Error("background_audio_shortcut_unavailable");
      try {
        await settings.save({
          ...(enabled !== undefined ? { isBackgroundAudioBalanceEnabled: enabled } : {}),
          ...(patch.shortcut !== undefined
            ? { backgroundAudioBalanceShortcut: patch.shortcut }
            : {}),
        });
      } catch (error) {
        bindShortcut(previous);
        throw error;
      }
      if (!settings.getSnapshot().isBackgroundAudioBalanceEnabled)
        controller?.update({ enabled: false, inRoom: false, speaking: false });
      return state();
    });
    configureQueue = operation.catch(() => undefined);
    return operation;
  };
  ipcMain.handle(IPC_CHANNELS.backgroundAudio.configure, (event, patch: unknown) => {
    check(event);
    if (
      !patch ||
      typeof patch !== "object" ||
      Array.isArray(patch) ||
      Object.keys(patch).some((key) => key !== "enabled" && key !== "shortcut") ||
      ("enabled" in patch && typeof patch.enabled !== "boolean") ||
      ("shortcut" in patch && (typeof patch.shortcut !== "string" || patch.shortcut.length > 80))
    )
      throw Error("background_audio_invalid_configuration");
    return configure(patch);
  });
  ipcMain.handle(IPC_CHANNELS.backgroundAudio.pulse, async (event, input: unknown) => {
    check(event);
    if (
      !input ||
      typeof input !== "object" ||
      !("inRoom" in input) ||
      !("speaking" in input) ||
      typeof input.inRoom !== "boolean" ||
      typeof input.speaking !== "boolean"
    )
      throw Error("background_audio_invalid_activity");
    const now = performance.now();
    if (now - lastPulse < 100 && controller) {
      controller.update({
        enabled: settings.getSnapshot().isBackgroundAudioBalanceEnabled === true,
        inRoom: input.inRoom,
        speaking: input.speaking,
      });
      return state();
    }
    lastPulse = now;
    await ensure().catch(() => undefined);
    check(event);
    bindShortcut("");
    controller?.update({
      enabled: settings.getSnapshot().isBackgroundAudioBalanceEnabled === true,
      inRoom: input.inRoom,
      speaking: input.speaking,
    });
    return state();
  });
  const timer = setInterval(() => {
    // Once restoration is complete, an idle disabled feature has no audio work.
    // Keep ticking during recovery so previously adjusted application volumes are restored.
    if (
      controller &&
      (settings.getSnapshot().isBackgroundAudioBalanceEnabled || controller.getPhase() !== "off")
    )
      void controller.tick();
  }, 100);
  timer.unref();
  void ensure().catch(() => undefined);
  const dispose = async () => {
    stopped = true;
    clearInterval(timer);
    if (accelerator) globalShortcut.unregister(accelerator);
    // Normal shutdown restores explicitly; pipe EOF also restores if Main is terminated.
    try {
      await controller?.stop();
    } finally {
      await backend.close();
    }
  };
  app.once("before-quit", () => {
    void dispose().catch(() => undefined);
  });
  return { dispose };
}
