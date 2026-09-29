import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { app } from "electron";

import { type AppSettings, type RendererLogPayload } from "@private-voice/shared";

import { defaultSettings, migrateSettings, type RawSettings } from "./settings-migration";

const SETTINGS_BOM = "\uFEFF";
const clearLegacyAvatarImage = async (avatarPath?: string): Promise<void> => {
  if (!avatarPath) return;
  const { clearAvatarImage } = await import("./profile-media");
  await clearAvatarImage(avatarPath);
};

export class SettingsStore {
  private cachedSettings: AppSettings = migrateSettings(defaultSettings).settings;
  private readonly filePath: string;
  private readonly backupFilePath: string;
  private persistQueue: Promise<void> = Promise.resolve();
  private writeProtected = false;

  constructor(
    private readonly writeLog?: (payload: RendererLogPayload) => Promise<void>,
    userDataDirectory = app.getPath("userData"),
  ) {
    this.filePath = path.join(userDataDirectory, "settings.json");
    this.backupFilePath = path.join(userDataDirectory, "settings.backup.json");
  }

  async load(): Promise<AppSettings> {
    const candidates = [this.filePath, this.backupFilePath];
    let unreadableCandidate = false;
    for (const candidate of candidates) {
      try {
        const fileContent = await readFile(candidate, "utf8");
        const parsed = JSON.parse(this.stripBom(fileContent)) as RawSettings;
        const { settings, migrated, previousVersion } = migrateSettings(parsed);
        this.cachedSettings = settings;
        this.writeProtected = false;
        // Opening an unchanged profile must not rewrite account-adjacent data or its backup.
        // Persist only a real normalization/migration or recovery from the backup file.
        const normalizedForDisk = JSON.parse(JSON.stringify(settings)) as RawSettings;
        if (
          candidate !== this.filePath ||
          migrated ||
          !isDeepStrictEqual(normalizedForDisk, parsed)
        ) {
          await this.persist(this.cachedSettings, candidate === this.filePath);
        }
        if (migrated) await clearLegacyAvatarImage(parsed.avatarPath);
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
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") unreadableCandidate = true;
        await this.log("warn", "settings candidate failed", {
          source: candidate === this.filePath ? "primary" : "backup",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    this.cachedSettings = migrateSettings(defaultSettings).settings;
    if (unreadableCandidate) {
      this.writeProtected = true;
      await this.log("error", "settings unreadable; original files preserved");
      return this.cachedSettings;
    }
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
    if (this.writeProtected) throw new Error("settings_unreadable");
    const { settings } = migrateSettings({
      ...this.cachedSettings,
      ...partial,
    });
    // Ignore semantic no-op saves. Besides avoiding needless disk writes, this keeps a
    // misbehaving renderer effect from turning settings persistence into a hot loop.
    if (isDeepStrictEqual(settings, this.cachedSettings)) return this.cachedSettings;
    const previousSettings = this.cachedSettings;
    this.cachedSettings = settings;
    try {
      await this.persist(this.cachedSettings);
    } catch (error) {
      if (this.cachedSettings === settings) this.cachedSettings = previousSettings;
      throw error;
    }
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
    const previousSettings = this.cachedSettings;
    const previousWriteProtected = this.writeProtected;
    this.writeProtected = false;
    this.cachedSettings = migrateSettings(defaultSettings).settings;
    try {
      await this.persist(this.cachedSettings);
    } catch (error) {
      this.cachedSettings = previousSettings;
      this.writeProtected = previousWriteProtected;
      throw error;
    }
    await clearLegacyAvatarImage(previousSettings.avatarPath);
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
        try {
          await copyFile(this.filePath, this.backupFilePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
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
