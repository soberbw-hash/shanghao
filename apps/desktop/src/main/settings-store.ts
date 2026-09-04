import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { app } from "electron";

import { type AppSettings, type RendererLogPayload } from "@private-voice/shared";

import { clearAvatarImage } from "./profile-media";
import { defaultSettings, migrateSettings, type RawSettings } from "./settings-migration";

const SETTINGS_BOM = "\uFEFF";

export class SettingsStore {
  private cachedSettings: AppSettings = migrateSettings(defaultSettings).settings;
  private readonly filePath = path.join(app.getPath("userData"), "settings.json");
  private readonly backupFilePath = path.join(app.getPath("userData"), "settings.backup.json");
  private persistQueue: Promise<void> = Promise.resolve();

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

    this.cachedSettings = migrateSettings(defaultSettings).settings;
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
    // Ignore semantic no-op saves. Besides avoiding needless disk writes, this keeps a
    // misbehaving renderer effect from turning settings persistence into a hot loop.
    if (isDeepStrictEqual(settings, this.cachedSettings)) return this.cachedSettings;
    this.cachedSettings = settings;
    await this.persist(this.cachedSettings);
    await this.log("info", "settings saved", {
      schemaVersion: this.cachedSettings.settingsSchemaVersion,
      avatarId: this.cachedSettings.avatarId,
      serverConfigured: Boolean(this.cachedSettings.relayServerUrl?.trim()),
      microphoneProcessingSampleRate: 48_000,
      micMonitorMode: this.cachedSettings.micMonitorMode,
      micEqualizerGains: this.cachedSettings.micEqualizerGains,
      isVoiceEnhancementEnabled: this.cachedSettings.isVoiceEnhancementEnabled,
      lowCutFrequency: this.cachedSettings.lowCutFrequency,
      isHardwareAccelerationEnabled: this.cachedSettings.isHardwareAccelerationEnabled,
      isOverlayEnabled: this.cachedSettings.isOverlayEnabled,
      isGameDetectionEnabled: this.cachedSettings.isGameDetectionEnabled,
      isUiSoundEnabled: this.cachedSettings.isUiSoundEnabled,
      soundVolume: this.cachedSettings.soundVolume,
    });
    return this.cachedSettings;
  }

  async reset(): Promise<AppSettings> {
    await clearAvatarImage(this.cachedSettings.avatarPath);
    this.cachedSettings = migrateSettings(defaultSettings).settings;
    await this.persist(this.cachedSettings);
    await this.log("info", "settings reset", {
      schemaVersion: this.cachedSettings.settingsSchemaVersion,
    });
    return this.cachedSettings;
  }

  private stripBom(value: string): string {
    return value.startsWith(SETTINGS_BOM) ? value.slice(1) : value;
  }

  private persist(settings: AppSettings, backupExisting = true): Promise<void> {
    const serialized = JSON.stringify(settings, null, 2);
    const operation = this.persistQueue
      .catch(() => undefined)
      .then(() => this.persistNow(serialized, backupExisting));
    this.persistQueue = operation;
    return operation;
  }

  private async persistNow(serialized: string, backupExisting: boolean): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryPath, serialized, {
      encoding: "utf8",
      flag: "wx",
    });
    try {
      if (backupExisting) {
        await copyFile(this.filePath, this.backupFilePath).catch(() => undefined);
      }
      // fs.rename cannot reliably replace an existing destination on Windows. copyFile uses
      // overwrite semantics, while the serialized queue prevents concurrent saves racing.
      await copyFile(temporaryPath, this.filePath);
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
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
