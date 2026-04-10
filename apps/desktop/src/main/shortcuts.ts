import { globalShortcut, type BrowserWindow } from "electron";

import { IPC_CHANNELS } from "@private-voice/shared";

export class ShortcutController {
  private currentMuteShortcut?: string;

  constructor(private readonly windowProvider: () => BrowserWindow | null) {}

  configureGlobalMute(accelerator: string): void {
    if (this.currentMuteShortcut) {
      globalShortcut.unregister(this.currentMuteShortcut);
    }

    if (!accelerator) {
      this.currentMuteShortcut = undefined;
      return;
    }

    const registered = globalShortcut.register(accelerator, () => {
      this.windowProvider()?.webContents.send(IPC_CHANNELS.shortcuts.muteTriggered);
    });

    if (!registered) {
      throw new Error(`Failed to register global shortcut: ${accelerator}`);
    }

    this.currentMuteShortcut = accelerator;
  }

  dispose(): void {
    globalShortcut.unregisterAll();
  }
}
