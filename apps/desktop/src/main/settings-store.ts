import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

import { type AppSettings, type RendererLogPayload } from "@private-voice/shared";

import { clearAvatarImage } from "./profile-media";
import { defaultSettings, migrateSettings, type RawSettings } from "./settings-migration";

const SETTINGS_BOM = "\uFEFF";

export class SettingsStore {
  private cachedSettings: AppSettings = defaultSettings;
  private readonly filePath = path.join(app.getPath("userData"), "settings.json");

  constructor(private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>) {}

  async load(): Promise<AppSettings> {
    try {
      const fileContent = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(this.stripBom(fileContent)) as RawSettings;
      const { settings, migrated, previousVersion } = migrateSettings(parsed);
      this.cachedSettings = settings;
      await this.persist(this.cachedSettings);
      await this.log("info", "settings loaded", {
        schemaVersion: settings.settingsSchemaVersion,
        previousVersion,
        migrated,
        hasAvatar: Boolean(settings.avatarPath),
        profileReady: settings.hasCompletedProfileSetup,
        connectionMode: settings.connectionMode,
      });
      return this.cachedSettings;
    } catch (error) {
      this.cachedSettings = defaultSettings;
      await this.persist(defaultSettings);
      await this.log("warn", "settings fallback", {
        error: error instanceof Error ? error.message : String(error),
        schemaVersion: defaultSettings.settingsSchemaVersion,
      });
      return this.cachedSettings;
    }
  }

  getSnapshot(): AppSettings {
    return this.cachedSettings;
  }

  async save(partial: Partial<AppSettings>): Promise<AppSettings> {
    const previousAvatarPath = this.cachedSettings.avatarPath;
    const { settings } = migrateSettings({
      ...this.cachedSettings,
      ...partial,
    });
    this.cachedSettings = settings;
    await this.persist(this.cachedSettings);
    if (partial.avatarPath !== undefined && previousAvatarPath !== partial.avatarPath) {
      await clearAvatarImage(previousAvatarPath);
    }
    await this.log("info", "settings saved", {
      schemaVersion: this.cachedSettings.settingsSchemaVersion,
      hasAvatar: Boolean(this.cachedSettings.avatarPath),
      nickname: this.cachedSettings.nickname,
      connectionMode: this.cachedSettings.connectionMode,
      preferredSampleRate: this.cachedSettings.preferredSampleRate,
      micMonitorMode: this.cachedSettings.micMonitorMode,
    });
    return this.cachedSettings;
  }

  async reset(): Promise<AppSettings> {
    await clearAvatarImage(this.cachedSettings.avatarPath);
    this.cachedSettings = defaultSettings;
    await this.persist(defaultSettings);
    await this.log("info", "settings reset", {
      schemaVersion: defaultSettings.settingsSchemaVersion,
    });
    return this.cachedSettings;
  }

  private stripBom(value: string): string {
    return value.startsWith(SETTINGS_BOM) ? value.slice(1) : value;
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

export { defaultSettings };
