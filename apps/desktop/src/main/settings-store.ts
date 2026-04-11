import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

import { DEFAULT_ROOM_NAME, type AppSettings, type RendererLogPayload } from "@private-voice/shared";

import { clearAvatarImage } from "./profile-media";

const SETTINGS_BOM = "\uFEFF";

export const defaultSettings: AppSettings = {
  nickname: "",
  roomName: DEFAULT_ROOM_NAME,
  avatarPath: undefined,
  hasCompletedProfileSetup: false,
  minimizeToTray: false,
  reduceMotion: false,
  launchOnStartup: false,
  preferredInputDeviceId: undefined,
  preferredOutputDeviceId: undefined,
  globalMuteShortcut: "",
  pushToTalkShortcut: "Space",
  isNoiseSuppressionEnabled: true,
  isPushToTalkEnabled: false,
  connectionMode: "direct_host",
  relayServerUrl: "",
  manualDirectHost: "",
  shouldAutoCopyInviteLink: true,
  isMicOnSoundEnabled: true,
  isMicOffSoundEnabled: true,
  isMemberJoinSoundEnabled: true,
  isMemberLeaveSoundEnabled: true,
  isConnectionSoundEnabled: true,
};

export class SettingsStore {
  private cachedSettings: AppSettings = defaultSettings;
  private readonly filePath = path.join(app.getPath("userData"), "settings.json");

  constructor(
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
  ) {}

  async load(): Promise<AppSettings> {
    try {
      const fileContent = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(this.stripBom(fileContent)) as Partial<AppSettings>;
      const mergedSettings = {
        ...defaultSettings,
        ...parsed,
      };
      this.cachedSettings = this.normalizeSettings(mergedSettings);
      await this.persist(this.cachedSettings);
      await this.log("info", "settings loaded", {
        hasAvatar: Boolean(this.cachedSettings.avatarPath),
        profileReady: this.cachedSettings.hasCompletedProfileSetup,
        connectionMode: this.cachedSettings.connectionMode,
      });
      return this.cachedSettings;
    } catch (error) {
      this.cachedSettings = defaultSettings;
      await this.persist(defaultSettings);
      await this.log("warn", "settings fallback", {
        error: error instanceof Error ? error.message : String(error),
      });
      return this.cachedSettings;
    }
  }

  getSnapshot(): AppSettings {
    return this.cachedSettings;
  }

  async save(partial: Partial<AppSettings>): Promise<AppSettings> {
    const previousAvatarPath = this.cachedSettings.avatarPath;
    this.cachedSettings = this.normalizeSettings({
      ...this.cachedSettings,
      ...partial,
    });
    await this.persist(this.cachedSettings);
    if (partial.avatarPath !== undefined && previousAvatarPath !== partial.avatarPath) {
      await clearAvatarImage(previousAvatarPath);
    }
    await this.log("info", "Saved settings", {
      hasAvatar: Boolean(this.cachedSettings.avatarPath),
      nickname: this.cachedSettings.nickname,
      connectionMode: this.cachedSettings.connectionMode,
    });
    return this.cachedSettings;
  }

  async reset(): Promise<AppSettings> {
    await clearAvatarImage(this.cachedSettings.avatarPath);
    this.cachedSettings = defaultSettings;
    await this.persist(defaultSettings);
    await this.log("info", "Reset settings to defaults");
    return this.cachedSettings;
  }

  private stripBom(value: string): string {
    return value.startsWith(SETTINGS_BOM) ? value.slice(1) : value;
  }

  private normalizeSettings(settings: AppSettings): AppSettings {
    const isProfileReady = settings.nickname.trim().length > 0 && Boolean(settings.avatarPath);
    const normalizedRoomName = settings.roomName.trim() || DEFAULT_ROOM_NAME;

    return {
      ...defaultSettings,
      ...settings,
      nickname: settings.nickname.trim(),
      roomName: normalizedRoomName,
      globalMuteShortcut: settings.globalMuteShortcut.trim(),
      relayServerUrl: settings.relayServerUrl?.trim(),
      manualDirectHost: settings.manualDirectHost?.trim(),
      hasCompletedProfileSetup:
        Boolean(settings.hasCompletedProfileSetup) && isProfileReady,
    };
  }

  private async persist(settings: AppSettings): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(settings, null, 2), {
      encoding: "utf8",
    });
  }

  private async log(
    level: RendererLogPayload["level"],
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    await this.writeLog?.({
      category: "app",
      level,
      message,
      context,
    });
  }
}
