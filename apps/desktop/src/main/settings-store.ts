import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

import { type AppSettings, type RendererLogPayload } from "@private-voice/shared";

import { clearAvatarImage } from "./profile-media";
import { defaultSettings, migrateSettings, type RawSettings } from "./settings-migration";

const SETTINGS_BOM = "\uFEFF";

export class SettingsStore {
  private cachedSettings: AppSettings = defaultSettings;
  private readonly filePath = path.join(app.getPath("userData"), "settings.json");
  private readonly backupFilePath = path.join(app.getPath("userData"), "settings.backup.json");

  constructor(private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>) {}

  async load(): Promise<AppSettings> {
    const candidates = [this.filePath, this.backupFilePath];
    for (const candidate of candidates) {
      try {
        const fileContent = await readFile(candidate, "utf8");
        const parsed = JSON.parse(this.stripBom(fileContent)) as RawSettings;
        const { settings, migrated, previousVersion } = migrateSettings(parsed);
        this.cachedSettings = settings;
        await this.persist(this.cachedSettings, candidate === this.filePath);
        if (migrated) await clearAvatarImage(parsed.avatarPath);
        await this.log("info", "settings loaded", {
          source: candidate === this.filePath ? "primary" : "backup",
          schemaVersion: settings.settingsSchemaVersion,
          previousVersion,
          migrated,
          avatarId: settings.avatarId,
          profileSchemaVersion: settings.profileSchemaVersion,
          profileReady: settings.hasCompletedProfileSetup,
          serverConfigured: Boolean(settings.relayServerUrl?.trim()),
        });
        return this.cachedSettings;
      } catch (error) {
        await this.log("warn", "settings candidate failed", {
          source: candidate === this.filePath ? "primary" : "backup",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.cachedSettings = structuredClone(defaultSettings);
    await this.persist(this.cachedSettings, false);
    await this.log("warn", "settings safe defaults restored", {
      schemaVersion: defaultSettings.settingsSchemaVersion,
    });
    return this.cachedSettings;
  }

  getSnapshot(): AppSettings {
    return this.cachedSettings;
  }

  async save(partial: Partial<AppSettings>): Promise<AppSettings> {
    const { settings } = migrateSettings({
      ...this.cachedSettings,
      ...partial,
    });
    this.cachedSettings = settings;
    await this.persist(this.cachedSettings);
    await this.log("info", "settings saved", {
      schemaVersion: this.cachedSettings.settingsSchemaVersion,
      avatarId: this.cachedSettings.avatarId,
      serverConfigured: Boolean(this.cachedSettings.relayServerUrl?.trim()),
      preferredSampleRate: this.cachedSettings.preferredSampleRate,
      micMonitorMode: this.cachedSettings.micMonitorMode,
      inputLevelThreshold: this.cachedSettings.inputLevelThreshold,
      micEqualizerGains: this.cachedSettings.micEqualizerGains,
      lowCutFrequency: this.cachedSettings.lowCutFrequency,
      isHardwareAccelerationEnabled: this.cachedSettings.isHardwareAccelerationEnabled,
      isOverlayEnabled: this.cachedSettings.isOverlayEnabled,
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

  private async persist(settings: AppSettings, backupExisting = true): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(settings, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    if (backupExisting) {
      await copyFile(this.filePath, this.backupFilePath).catch(() => undefined);
    }
    await rename(temporaryPath, this.filePath);
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
