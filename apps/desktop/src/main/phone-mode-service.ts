import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { createInterface } from "node:readline";
import { app, ipcMain, powerMonitor, type BrowserWindow } from "electron";
import { IPC_CHANNELS } from "@private-voice/shared";
import type { SettingsStore } from "./settings-store";
import type { ShortcutController } from "./shortcuts";
import { sendToWindow } from "./safe-web-contents";
import { platformService } from "./platform/PlatformService";

type State = { active: boolean; busy: boolean; error?: string };
export function registerPhoneMode(
  getWindow: () => BrowserWindow | null,
  settings: SettingsStore,
  shortcuts: ShortcutController,
): void {
  let state: State = { active: false, busy: false };
  let helper: ChildProcessWithoutNullStreams | undefined;
  let ready: Promise<void> | undefined;
  let devices = { inputDeviceId: "", outputDeviceId: "" };
  let sequence = 0;
  let desiredRevision = 0;
  let desiredActive = false;
  let queue = Promise.resolve();
  let closing = false;
  const pending = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout; active: boolean }
  >();
  const publish = (next: State) => {
    state = next;
    sendToWindow(getWindow(), IPC_CHANNELS.phoneMode.changed, state);
  };
  const start = (): Promise<void> => {
    if (closing) return Promise.reject(new Error("软件正在退出"));
    if (ready) return ready;
    if (!platformService.isWindows) return Promise.reject(new Error("电话模式目前仅支持 Windows"));
    const executable = app.isPackaged
      ? path.join(process.resourcesPath, "native", "ShangHao.PhoneAudio.exe")
      : path.join(app.getAppPath(), "resources/native/ShangHao.PhoneAudio.exe");
    const child = spawn(
      executable,
      [
        path.join(app.getPath("userData"), "phone-mode-recovery.json"),
        ...(state.active ? ["--keep-muted"] : []),
      ],
      { windowsHide: true, stdio: "pipe" },
    );
    helper = child;
    // The helper can close its stdin before Electron's quit hook runs. Node emits
    // ERR_STREAM_WRITE_AFTER_END asynchronously from end(), not as a thrown error.
    child.stdin.on("error", (error) => {
      if (!closing && state.active) {
        publish({ active: true, busy: false, error: error.message });
      }
    });
    const endInput = (finalCommand?: string) => {
      if (child.stdin.destroyed || child.stdin.writableEnded) return;
      child.stdin.end(finalCommand);
    };
    ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("电话模式助手启动超时"));
        endInput();
      }, 5000);
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        try {
          const response = JSON.parse(line) as {
            id: number;
            ready?: boolean;
            active: boolean;
            error?: string;
          };
          if (response.ready) {
            clearTimeout(timeout);
            if (response.error) {
              publish({
                active: state.active || response.active,
                busy: false,
                error: response.error,
              });
              reject(new Error(response.error));
              // Retire a failed startup so the next explicit attempt can retry.
              // The native helper preserves mute on pipe loss while active.
              endInput();
            } else resolve();
            return;
          }
          const request = pending.get(response.id);
          if (request) {
            clearTimeout(request.timer);
            pending.delete(response.id);
            if (response.error) request.reject(new Error(response.error));
            else if (response.active !== request.active)
              request.reject(new Error("系统音频状态未确认，请使用硬件静音"));
            else request.resolve();
          } else if (response.error && response.id === 0)
            publish({
              active: state.active || response.active,
              busy: false,
              error: response.error,
            });
        } catch {
          /* Ignore malformed stdout; bounded request timeout handles it. */
        }
      });
      let stderr = "";
      let ended = false;
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + String(chunk)).slice(-2000);
      });
      const failed = () => {
        if (ended) return;
        ended = true;
        clearTimeout(timeout);
        lines.close();
        if (helper === child) {
          helper = undefined;
          ready = undefined;
        }
        const error = new Error(stderr.trim() || "电话模式助手已退出，请重试；恢复记录已保留");
        reject(error);
        for (const item of pending.values()) {
          clearTimeout(item.timer);
          item.reject(error);
        }
        pending.clear();
        if (!closing && state.active) {
          // Keep ShangHao gated. Restarting here would restore the journal and
          // unexpectedly reopen microphones in the middle of a private call.
          publish({ active: true, busy: false, error: error.message });
        }
      };
      child.once("error", failed);
      child.once("exit", failed);
    });
    return ready;
  };
  const command = async (active: boolean) => {
    await start();
    if (closing || !helper || helper.stdin.destroyed || helper.stdin.writableEnded) {
      throw new Error("电话模式助手已退出");
    }
    const id = ++sequence;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("系统静音状态未确认，上号保持静音。请使用硬件静音后重试"));
      }, 5000);
      pending.set(id, { resolve, reject, timer, active });
      helper!.stdin.write(JSON.stringify({ id, active, ...devices }) + "\n", (error) => {
        if (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
        }
      });
    });
  };
  const setActive = (active: boolean): Promise<void> => {
    if (closing) return Promise.reject(new Error("软件正在退出"));
    // Gate immediately on press; release only after native restoration is confirmed.
    desiredActive = active;
    const request = ++desiredRevision;
    publish({ active: active || state.active, busy: true });
    const operation = queue
      // Keep the in-flight command serialized, discarding obsolete queued transitions.
      .then(() => (request === desiredRevision ? command(active) : undefined))
      .then(() => {
        if (request === desiredRevision) publish({ active, busy: false });
      })
      .catch((error) => {
        if (request === desiredRevision)
          publish({
            active: true,
            busy: false,
            error: error instanceof Error ? error.message : String(error),
          });
        throw error;
      });
    queue = operation.catch(() => undefined);
    return operation;
  };
  const safeSet = (active: boolean) => {
    void setActive(active).catch(() => undefined);
  };
  const configure = (shortcut: string, trigger: "hold" | "toggle") =>
    shortcuts.configurePhone(shortcut, trigger, (active) =>
      safeSet(active ?? (state.error ? false : !desiredActive)),
    );
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    const window = getWindow();
    if (
      !window ||
      event.sender.id !== window.webContents.id ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("phone_mode_untrusted_sender");
  };
  ipcMain.handle(IPC_CHANNELS.phoneMode.get, (event) => {
    trusted(event);
    return state;
  });
  ipcMain.handle(IPC_CHANNELS.phoneMode.set, (event, active: unknown) => {
    trusted(event);
    if (typeof active !== "boolean") throw new Error("invalid_phone_mode");
    return setActive(active);
  });
  ipcMain.handle(IPC_CHANNELS.phoneMode.devices, (event, value: typeof devices) => {
    trusted(event);
    if (
      !value ||
      [value.inputDeviceId, value.outputDeviceId].some(
        (deviceId) => typeof deviceId !== "string" || deviceId.length > 512,
      )
    )
      throw new Error("invalid_audio_devices");
    devices = value;
    if (desiredActive) return setActive(true);
  });
  ipcMain.handle(
    IPC_CHANNELS.phoneMode.configure,
    async (event, shortcut: unknown, trigger: unknown) => {
      trusted(event);
      if (
        typeof shortcut !== "string" ||
        shortcut.length > 80 ||
        (trigger !== "hold" && trigger !== "toggle")
      )
        throw new Error("invalid_phone_shortcut");
      const current = settings.getSnapshot();
      const conflict = [
        [current.recordingMarkerShortcut, "精彩时刻录制"],
        [current.isPushToTalkEnabled ? current.pushToTalkShortcut : "", "按键说话"],
        [current.globalMuteShortcut, "麦克风静音"],
      ].find(([value]) => shortcut && value?.toLowerCase() === shortcut.toLowerCase());
      if (conflict) throw new Error(`该快捷键已用于${conflict[1]}，请先更改该功能的快捷键`);
      configure(shortcut, trigger);
      try {
        await settings.save({ phoneModeShortcut: shortcut, phoneModeTrigger: trigger });
      } catch (error) {
        configure(current.phoneModeShortcut ?? "", current.phoneModeTrigger ?? "hold");
        throw error;
      }
    },
  );
  // Renderer reload/crash, screen lock and suspend are not user requests to
  // end a private call. Keep native mute until the shortcut explicitly releases.
  powerMonitor.on("resume", () => {
    if (desiredActive) safeSet(true);
  });
  app.on("before-quit", () => {
    closing = true;
    shortcuts.resetPhonePress();
    // Explicit app exit restores; unexpected pipe loss in the helper stays muted.
    if (helper && !helper.stdin.destroyed && !helper.stdin.writableEnded) {
      helper.stdin.end(JSON.stringify({ id: ++sequence, active: false }) + "\n");
    }
  });
  // Load without muting: recover an interrupted previous session immediately.
  if (platformService.isWindows)
    void start().catch((error) =>
      publish({ active: state.active, busy: false, error: String(error.message ?? error) }),
    );
  try {
    const current = settings.getSnapshot();
    configure(current.phoneModeShortcut ?? "", current.phoneModeTrigger ?? "hold");
  } catch (error) {
    publish({ active: state.active, busy: false, error: String(error) });
  }
}
