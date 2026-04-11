import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

import { DEFAULT_ROOM_NAME, type AppSettings } from "@private-voice/shared";

import { clearAvatarImage } from "./profile-media";

export const defaultSettings: AppSettings = {
  nickname: "",
  roomName: DEFAULT_ROOM_NAME,
  avatarPath: undefined,
  hasCompletedProfileSetup: false,
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
      const mergedSettings = {
        ...defaultSettings,
        ...parsed,
      };
      this.cachedSettings = this.normalizeSettings(mergedSettings);
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
    const previousAvatarPath = this.cachedSettings.avatarPath;
    this.cachedSettings = {
      ...this.cachedSettings,
      ...partial,
    };
    this.cachedSettings = this.normalizeSettings(this.cachedSettings);
    await this.persist(this.cachedSettings);
    if (partial.avatarPath !== undefined && previousAvatarPath !== partial.avatarPath) {
      await clearAvatarImage(previousAvatarPath);
    }
    return this.cachedSettings;
  }

  async reset(): Promise<AppSettings> {
    await clearAvatarImage(this.cachedSettings.avatarPath);
    this.cachedSettings = defaultSettings;
    await this.persist(defaultSettings);
    return this.cachedSettings;
  }

  private normalizeSettings(settings: AppSettings): AppSettings {
    const isProfileReady = settings.nickname.trim().length > 0 && Boolean(settings.avatarPath);
    return {
      ...settings,
      nickname: settings.nickname.trim(),
      roomName: settings.roomName.trim() || DEFAULT_ROOM_NAME,
      hasCompletedProfileSetup:
        Boolean(settings.hasCompletedProfileSetup) && isProfileReady,
    };
  }

  private async persist(settings: AppSettings): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(settings, null, 2), "utf8");
  }
}
