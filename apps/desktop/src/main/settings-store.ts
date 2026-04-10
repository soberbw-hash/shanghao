import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

import { DEFAULT_ROOM_NAME, type AppSettings } from "@private-voice/shared";

export const defaultSettings: AppSettings = {
  nickname: "新成员",
  roomName: DEFAULT_ROOM_NAME,
  minimizeToTray: true,
  reduceMotion: false,
  launchOnStartup: false,
  preferredInputDeviceId: undefined,
  preferredOutputDeviceId: undefined,
  globalMuteShortcut: "CommandOrControl+Shift+M",
  pushToTalkShortcut: "Space",
  isNoiseSuppressionEnabled: true,
  isPushToTalkEnabled: false,
};

export class SettingsStore {
  private cachedSettings: AppSettings = defaultSettings;
  private readonly filePath = path.join(app.getPath("userData"), "settings.json");

  async load(): Promise<AppSettings> {
    try {
      const fileContent = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(fileContent) as Partial<AppSettings>;
      this.cachedSettings = {
        ...defaultSettings,
        ...parsed,
      };
      return this.cachedSettings;
    } catch {
      await this.persist(defaultSettings);
      return this.cachedSettings;
    }
  }

  getSnapshot(): AppSettings {
    return this.cachedSettings;
  }

  async save(partial: Partial<AppSettings>): Promise<AppSettings> {
    this.cachedSettings = {
      ...this.cachedSettings,
      ...partial,
    };
    await this.persist(this.cachedSettings);
    return this.cachedSettings;
  }

  async reset(): Promise<AppSettings> {
    this.cachedSettings = defaultSettings;
    await this.persist(defaultSettings);
    return this.cachedSettings;
  }

  private async persist(settings: AppSettings): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(settings, null, 2), "utf8");
  }
}
