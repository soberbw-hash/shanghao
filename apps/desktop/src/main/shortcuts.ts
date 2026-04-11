import { globalShortcut, type BrowserWindow } from "electron";

import { IPC_CHANNELS, type RendererLogPayload } from "@private-voice/shared";

export class ShortcutController {
  private currentMuteShortcut?: string;

  constructor(
    private readonly windowProvider: () => BrowserWindow | null,
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
  ) {}

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
        this.windowProvider()?.webContents.send(IPC_CHANNELS.shortcuts.muteTriggered);
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

  dispose(): void {
    globalShortcut.unregisterAll();
  }
}
