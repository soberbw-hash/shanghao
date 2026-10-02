import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_AI_ASR_MODEL_ID,
  DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
  DEFAULT_QUICK_MESSAGE_SLOTS,
  PROFILE_SCHEMA_VERSION,
  QUICK_MESSAGE_PRESETS,
  SETTINGS_SCHEMA_VERSION,
} from "@private-voice/shared";

import { defaultSettings, migrateSettings } from "../src/main/settings-migration";

test("all quick-message shortcuts require explicit opt-in without erasing saved bindings", () => {
  assert.equal(defaultSettings.quickMessages.shortcutsEnabled, false);
  const legacy = { ...defaultSettings.quickMessages };
  delete legacy.shortcutsEnabled;
  const musicSlots = legacy.musicSlots.map((slot, index) => ({
    ...slot,
    shortcut: index === 0 ? "Mouse4" : slot.shortcut,
    enabled: index !== 1,
  }));
  const upgraded = migrateSettings({
    ...defaultSettings,
    quickMessages: { ...legacy, musicShortcutsEnabled: true, musicSlots },
  }).settings;
  assert.equal(upgraded.quickMessages.shortcutsEnabled, false);
  assert.equal(upgraded.quickMessages.musicShortcutsEnabled, true);
  assert.deepEqual(upgraded.quickMessages.slots, legacy.slots);
  assert.deepEqual(upgraded.quickMessages.musicSlots, musicSlots);
  const enabled = migrateSettings({
    ...upgraded,
    quickMessages: { ...upgraded.quickMessages, shortcutsEnabled: true },
  }).settings;
  assert.equal(enabled.quickMessages.shortcutsEnabled, true);
  assert.deepEqual(enabled.quickMessages.slots, legacy.slots);
  assert.deepEqual(enabled.quickMessages.musicSlots, musicSlots);
  const disabled = migrateSettings({
    ...enabled,
    quickMessages: { ...enabled.quickMessages, shortcutsEnabled: false },
  }).settings;
  assert.equal(disabled.quickMessages.shortcutsEnabled, false);
  assert.deepEqual(disabled.quickMessages.slots, legacy.slots);
  assert.deepEqual(disabled.quickMessages.musicSlots, musicSlots);
});
test("friend notifications and local game markers default on and preserve explicit opt-out", () => {
  const defaults = migrateSettings({}).settings;
  assert.equal(defaults.isFriendOnlineNotificationEnabled, true);
  assert.equal(defaults.isRecordingAutoGameMarkerEnabled, true);
  const saved = migrateSettings({
    isFriendOnlineNotificationEnabled: false,
    isRecordingAutoGameMarkerEnabled: false,
  }).settings;
  assert.equal(saved.isFriendOnlineNotificationEnabled, false);
  assert.equal(saved.isRecordingAutoGameMarkerEnabled, false);
});

test("clip and tray preferences use safe defaults and preserve customized profiles", () => {
  const old = migrateSettings({ minimizeToTray: true, quickMessageVolume: 27 }).settings;
  assert.equal(old.isFriendOnlineNotificationEnabled, true);
  assert.equal(old.hasSeenTrayNotice, false);
  assert.equal(old.hasDismissedRecordingClipConsent, false);
  assert.equal(old.recordingClipBeforeMs, 20_000);
  assert.equal(old.recordingClipAfterMs, 8_000);
  assert.equal(old.minimizeToTray, true);
  const saved = migrateSettings({
    ...old,
    isFriendOnlineNotificationEnabled: true,
    hasSeenTrayNotice: true,
    hasDismissedRecordingClipConsent: true,
    recordingClipBeforeMs: 33_000,
    recordingClipAfterMs: 12_000,
  }).settings;
  assert.equal(saved.isFriendOnlineNotificationEnabled, true);
  assert.equal(saved.hasSeenTrayNotice, true);
  assert.equal(saved.hasDismissedRecordingClipConsent, true);
  assert.equal(saved.recordingClipBeforeMs, 33_000);
  assert.equal(saved.recordingClipAfterMs, 12_000);
});

test("new profiles recommend GLM without replacing an existing ASR choice", () => {
  assert.equal(DEFAULT_AI_ASR_MODEL_ID, "glm-asr-nano-2512");
  assert.equal(defaultSettings.aiAsrModel, DEFAULT_AI_ASR_MODEL_ID);
  assert.equal(migrateSettings(defaultSettings).settings.aiAsrModel, DEFAULT_AI_ASR_MODEL_ID);
  assert.equal(
    migrateSettings({ ...defaultSettings, aiAsrModel: "qwen3-asr-0.6b-force" }).settings.aiAsrModel,
    "qwen3-asr-0.6b-force",
  );
});

test("retired Dolphin preference keeps the legacy fallback without changing retained choices", () => {
  assert.equal(
    migrateSettings({ ...defaultSettings, aiAsrModel: "dolphin-cn-dialect-0.4b" as never }).settings
      .aiAsrModel,
    "qwen3-asr-0.6b-force",
  );
  for (const aiAsrModel of [
    "glm-asr-nano-2512",
    "moss-transcribe-diarize-0.9b-q8_0",
    "qwen3-asr-1.7b-force",
  ] as const) {
    assert.equal(
      migrateSettings({ ...defaultSettings, aiAsrModel }).settings.aiAsrModel,
      aiAsrModel,
    );
  }
});

test("migrateSettings falls back to safe defaults for damaged legacy config", () => {
  const result = migrateSettings({
    nickname: "阿北",
    globalMuteShortcut: "Ctrl+Shift+M",
    preferredSampleRate: "99999" as never,
    inputLevelThreshold: -10,
    settingsSchemaVersion: 0,
    shouldAutoCopyInviteLink: false,
    channelAccessCode: "legacy-code",
    manualDirectHost: "203.0.113.8",
    isMicOnSoundEnabled: false,
    isMicOffSoundEnabled: false,
    isMemberJoinSoundEnabled: false,
    isMemberLeaveSoundEnabled: false,
    isConnectionSoundEnabled: false,
    isUiSoundEnabled: false,
    isHardwareAccelerationEnabled: "invalid" as never,
    isOverlayEnabled: "invalid" as never,
    micEqualizerGains: [99, -99, 3, Number.NaN] as never,
    micMonitorMode: "raw",
    colorTheme: "dark",
  });

  assert.equal(result.settings.settingsSchemaVersion, SETTINGS_SCHEMA_VERSION);
  assert.equal(result.settings.profileSchemaVersion, PROFILE_SCHEMA_VERSION);
  assert.match(
    result.settings.profileId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(result.settings.avatarId, "fox");
  assert.equal(result.settings.avatarPath, undefined);
  assert.equal(result.settings.nickname, "");
  assert.equal(result.settings.globalMuteShortcut, "");
  assert.equal("preferredSampleRate" in result.settings, false);
  assert.equal("inputLevelThreshold" in result.settings, false);
  assert.equal(result.settings.isVoiceEnhancementEnabled, true);
  assert.equal(result.settings.hasCompletedProfileSetup, false);
  assert.equal("shouldAutoCopyInviteLink" in result.settings, false);
  assert.equal("channelAccessCode" in result.settings, false);
  assert.equal("manualDirectHost" in result.settings, false);
  assert.equal("connectionMode" in result.settings, false);
  assert.equal("colorTheme" in result.settings, false);
  assert.equal("isMicOnSoundEnabled" in result.settings, false);
  assert.equal("isMicOffSoundEnabled" in result.settings, false);
  assert.equal("isMemberJoinSoundEnabled" in result.settings, false);
  assert.equal("isMemberLeaveSoundEnabled" in result.settings, false);
  assert.equal("isConnectionSoundEnabled" in result.settings, false);
  assert.equal(result.settings.isUiSoundEnabled, true);
  assert.equal(result.settings.isSystemNotificationEnabled, true);
  assert.equal(result.settings.isGameDetectionEnabled, true);
  assert.equal("launchOnStartup" in result.settings, false);
  assert.equal(result.settings.lastReleaseNotesVersionSeen, undefined);
  assert.equal(result.settings.soundVolume, defaultSettings.soundVolume);
  assert.equal(result.settings.isHardwareAccelerationEnabled, true);
  assert.equal(result.settings.isOverlayEnabled, true);
  assert.equal(result.settings.isDynamicWeatherEnabled, true);
  assert.equal(result.settings.isFriendLoudnessBalanceEnabled, true);
  assert.equal("isRecordingLoudnessBalanceEnabled" in result.settings, false);
  assert.equal(result.settings.weatherLocationMode, "auto");
  assert.equal(result.settings.weatherManualCity, "");
  assert.equal(result.settings.isSystemWeatherLocationEnabled, false);
  assert.equal(result.settings.weatherEffectMode, "standard");
  assert.deepEqual(result.settings.micEqualizerGains, [0, 0, 0, 0, 0]);
  assert.equal(result.settings.lowCutFrequency, "75");
  assert.equal(result.settings.micMonitorMode, "processed");
  assert.equal(result.migrated, true);
});

test("friend loudness balance is on by default and explicit choices survive migration", () => {
  assert.equal(migrateSettings({}).settings.isFriendLoudnessBalanceEnabled, true);
  assert.equal(
    migrateSettings({ ...defaultSettings, isFriendLoudnessBalanceEnabled: false }).settings
      .isFriendLoudnessBalanceEnabled,
    false,
  );
});

test("voice transcription defaults to manual and only preserves an intentional automatic mode", () => {
  assert.equal(defaultSettings.aiProcessingMode, "manual");
  assert.equal(migrateSettings({}).settings.aiProcessingMode, "manual");
  assert.equal(
    migrateSettings({
      settingsSchemaVersion: 34,
      aiProcessingMode: "after_game",
      isAiAutoTranscribeEnabled: false,
    }).settings.aiProcessingMode,
    "manual",
  );
  assert.equal(
    migrateSettings({
      settingsSchemaVersion: 34,
      aiProcessingMode: "after_game",
      isAiAutoTranscribeEnabled: true,
    }).settings.aiProcessingMode,
    "after_game",
  );
  assert.equal(
    migrateSettings({
      ...defaultSettings,
      aiProcessingMode: "immediate",
      isAiAutoTranscribeEnabled: true,
    }).settings.aiProcessingMode,
    "immediate",
  );
});

test("recording library cleanup defaults to 20 GB and upgrades the old 10 GB default", () => {
  assert.equal(defaultSettings.recordingLibraryQuotaGb, 20);
  assert.equal(
    migrateSettings({
      settingsSchemaVersion: 32,
      recordingLibraryQuotaGb: 10,
    }).settings.recordingLibraryQuotaGb,
    20,
  );
  assert.equal(
    migrateSettings({
      ...defaultSettings,
      recordingLibraryQuotaGb: 15,
    }).settings.recordingLibraryQuotaGb,
    15,
  );
});

test("interface sounds remain enabled at the product default volume", () => {
  const result = migrateSettings({
    ...defaultSettings,
    soundVolume: 0.31,
    isUiSoundEnabled: false,
  });

  assert.equal(result.settings.soundVolume, defaultSettings.soundVolume);
  assert.equal(result.settings.isUiSoundEnabled, true);
  assert.equal(
    migrateSettings({ soundVolume: 9 }).settings.soundVolume,
    defaultSettings.soundVolume,
  );
  assert.equal(
    migrateSettings({ soundVolume: -1 }).settings.soundVolume,
    defaultSettings.soundVolume,
  );
});

test("new quick-message profiles start with eight voices and five distinct music clips", () => {
  const settings = migrateSettings({}).settings.quickMessages;
  for (const slots of [settings.slots, settings.musicSlots]) {
    assert.ok(slots.every((slot) => slot.presetId && slot.enabled && slot.shortcut));
    assert.equal(new Set(slots.map((slot) => slot.presetId)).size, slots.length);
  }
  assert.equal(settings.slots.length, DEFAULT_QUICK_MESSAGE_SLOTS.length);
  assert.equal(settings.musicSlots.length, DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS.length);
  assert.equal(
    new Set([...settings.slots, ...settings.musicSlots].map((slot) => slot.shortcut)).size,
    settings.slots.length + settings.musicSlots.length,
  );
  for (const slot of settings.musicSlots) {
    assert.equal(
      QUICK_MESSAGE_PRESETS.find((preset) => preset.id === slot.presetId)?.mediaType,
      "music",
    );
  }
  for (const slot of settings.slots) {
    assert.notEqual(
      QUICK_MESSAGE_PRESETS.find((preset) => preset.id === slot.presetId)?.mediaType,
      "music",
    );
  }
});

test("saved quick-message bindings and intentionally empty slots survive an update", () => {
  const saved = JSON.parse(
    JSON.stringify({
      ...defaultSettings,
      quickMessages: {
        ...defaultSettings.quickMessages,
        slots: defaultSettings.quickMessages.slots.map((slot, index) =>
          index === 0 ? { ...slot, presetId: undefined, enabled: false } : slot,
        ),
        musicSlots: defaultSettings.quickMessages.musicSlots.map((slot, index) =>
          index === 4 ? { ...slot, presetId: undefined, enabled: false } : slot,
        ),
      },
    }),
  );
  const migrated = migrateSettings(saved).settings.quickMessages;
  assert.equal(migrated.slots[0]?.presetId, undefined);
  assert.equal(migrated.musicSlots[4]?.presetId, undefined);
  assert.equal(migrated.slots[1]?.presetId, "legacy-shanghao");
  assert.equal(migrated.musicSlots[3]?.presetId, "music-lol-卡特小曲");
  assert.deepEqual(
    migrateSettings({ ...defaultSettings, quickMessages: migrated }).settings.quickMessages,
    migrated,
  );
});

test("quick message settings keep old bindings without filling saved sparse slots", () => {
  const migrated = migrateSettings({
    ...defaultSettings,
    quickMessages: {
      soundEnabled: false,
      soundVolume: 2,
      slots: [
        { presetId: "legacy-shanghao", shortcut: " Ctrl+Alt+9 ", enabled: false },
        { presetId: "missing", shortcut: "", enabled: true },
      ],
    },
  });

  assert.equal(migrated.settings.quickMessages.soundEnabled, false);
  assert.equal(migrated.settings.quickMessages.soundVolume, 1);
  assert.equal(
    migrated.settings.quickMessages.musicPresetId,
    defaultSettings.quickMessages.musicPresetId,
  );
  assert.equal(migrated.settings.quickMessages.musicSlots.length, 5);
  assert.deepEqual(migrated.settings.quickMessages.musicSlots[0], {
    presetId: defaultSettings.quickMessages.musicSlots[0]?.presetId,
    shortcut: defaultSettings.quickMessages.musicSlots[0]?.shortcut,
    enabled: defaultSettings.quickMessages.musicSlots[0]?.enabled,
  });
  assert.equal(migrated.settings.quickMessages.musicSlots[3]?.presetId, undefined);
  assert.equal(migrated.settings.quickMessages.slots.length, 8);
  assert.deepEqual(migrated.settings.quickMessages.slots[0], {
    presetId: "legacy-shanghao",
    shortcut: "Ctrl+Alt+9",
    enabled: false,
  });
  assert.equal(migrated.settings.quickMessages.slots[1]?.presetId, "missing");
  assert.equal(migrated.settings.quickMessages.slots[4]?.presetId, undefined);
  assert.equal(migrated.settings.quickMessages.slots[5]?.presetId, undefined);

  const restoredMusic = migrateSettings({
    ...defaultSettings,
    quickMessages: {
      ...defaultSettings.quickMessages,
      musicPresetId: " music-lol-卡特小曲 ",
    },
  });
  assert.equal(restoredMusic.settings.quickMessages.musicPresetId, "music-lol-卡特小曲");
});

test("quick message volume defaults to 15% without changing saved or legacy levels", () => {
  assert.equal(defaultSettings.quickMessages.soundVolume, 0.15);
  assert.equal(migrateSettings({}).settings.quickMessages.soundVolume, 0.15);
  assert.equal(
    migrateSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION - 1,
      quickMessages: {
        ...defaultSettings.quickMessages,
        soundVolume: 0.72,
      },
    }).settings.quickMessages.soundVolume,
    0.68,
  );
  assert.equal(
    migrateSettings({
      ...defaultSettings,
      quickMessages: { ...defaultSettings.quickMessages, soundVolume: 0.68 },
    }).settings.quickMessages.soundVolume,
    0.68,
  );
  assert.equal(
    migrateSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION - 1,
      quickMessages: {
        ...defaultSettings.quickMessages,
        soundVolume: 0.61,
      },
    }).settings.quickMessages.soundVolume,
    0.61,
  );
});

test("removed legacy quick message preset is cleared from saved shortcuts", () => {
  const migrated = migrateSettings({
    ...defaultSettings,
    quickMessages: {
      ...defaultSettings.quickMessages,
      slots: [
        { presetId: "legacy-ok", shortcut: "Ctrl+Alt+1", enabled: true },
        ...defaultSettings.quickMessages.slots.slice(1),
      ],
    },
  });

  assert.deepEqual(migrated.settings.quickMessages.slots[0], {
    presetId: undefined,
    shortcut: "Ctrl+Alt+1",
    enabled: false,
  });
});

test("legacy recording loudness preference is discarded because the pipeline always enables it", () => {
  assert.equal("isRecordingLoudnessBalanceEnabled" in migrateSettings({}).settings, false);
  assert.equal(
    "isRecordingLoudnessBalanceEnabled" in
      migrateSettings({
        ...defaultSettings,
        isRecordingLoudnessBalanceEnabled: false,
      }).settings,
    false,
  );
});

test("ASR model selection preserves supported providers and repairs damaged values", () => {
  assert.equal(migrateSettings({}).settings.aiAsrModel, "qwen3-asr-0.6b-force");
  for (const aiAsrModel of [
    "qwen3-asr-1.7b-force",
    "qwen3-asr-0.6b-force",
    "fun-asr-nano-2512",
    "glm-asr-nano-2512",
    "fireredasr2-aed",
    "paraformer-zh",
    "moss-transcribe-diarize-0.9b-q8_0",
    "ark-asr-3b-q8_0",
  ] as const) {
    assert.equal(
      migrateSettings({ ...defaultSettings, aiAsrModel }).settings.aiAsrModel,
      aiAsrModel,
    );
  }
  assert.equal(
    migrateSettings({ ...defaultSettings, aiAsrModel: "unknown-asr" as never }).settings.aiAsrModel,
    "qwen3-asr-0.6b-force",
  );
  assert.equal(
    migrateSettings({ ...defaultSettings, aiAsrModel: "vibevoice" as never }).settings.aiAsrModel,
    "qwen3-asr-0.6b-force",
  );
  assert.equal(
    migrateSettings({ ...defaultSettings, aiAsrModel: "fireredasr2-llm" as never }).settings
      .aiAsrModel,
    "qwen3-asr-0.6b-force",
  );
  assert.equal(
    migrateSettings({ ...defaultSettings, aiAsrModel: "qwen3-asr-0.6b" as never }).settings
      .aiAsrModel,
    "qwen3-asr-0.6b-force",
  );
});

test("weather stays enabled when legacy settings turned it off", () => {
  const result = migrateSettings({
    ...defaultSettings,
    weatherLocationMode: "manual",
    weatherManualCity: " 杭州 ",
    isSystemWeatherLocationEnabled: true,
    weatherEffectMode: "reduced",
    isDynamicWeatherEnabled: false,
  });

  assert.equal(result.settings.weatherLocationMode, "manual");
  assert.equal(result.settings.weatherManualCity, "杭州");
  assert.equal(result.settings.isSystemWeatherLocationEnabled, true);
  assert.equal(result.settings.weatherEffectMode, "standard");
  assert.equal(result.settings.isDynamicWeatherEnabled, true);
});

test("collection read markers migrate by room without accepting unknown room keys", () => {
  const legacy = "2026-09-30T00:00:00.000Z";
  const result = migrateSettings({
    ...defaultSettings,
    lastCollectionViewedAt: legacy,
    hasInitializedCollectionReadState: true,
    collectionViewedAtByRoom: {
      main: "2026-09-30T00:05:00.000Z",
      side: "invalid",
      other: "2026-09-30T00:06:00.000Z",
    } as never,
  });
  assert.equal(result.settings.lastCollectionViewedAt, legacy);
  assert.deepEqual(result.settings.collectionViewedAtByRoom, {
    main: "2026-09-30T00:05:00.000Z",
  });
});

test("legacy room question providers follow the unified text provider", () => {
  for (const aiRoomAskProvider of ["local", "custom"] as const) {
    const result = migrateSettings({ ...defaultSettings, aiRoomAskProvider });
    assert.equal(result.settings.aiRoomAskProvider, "cloud");
  }
});

test("automatic organization and upload default off while explicit preferences survive", () => {
  const initial = migrateSettings({
    ...defaultSettings,
    isAiAutoUploadEnabled: undefined,
  }).settings;
  assert.equal(initial.isAiAutoOrganizeEnabled, false);
  assert.equal(initial.isAiAutoUploadEnabled, false);
  const custom = migrateSettings({
    ...defaultSettings,
    aiOrganizerProvider: "custom",
    aiRoomAskProvider: "cloud",
    isAiAutoOrganizeEnabled: true,
    isAiAutoUploadEnabled: true,
  }).settings;
  assert.equal(custom.aiRoomAskProvider, "custom");
  assert.equal(custom.isAiAutoOrganizeEnabled, true);
  assert.equal(custom.isAiAutoUploadEnabled, true);
});

test("migrateSettings preserves the release notes version already shown", () => {
  const result = migrateSettings({
    ...defaultSettings,
    lastReleaseNotesVersionSeen: "2.4.0",
  });

  assert.equal(result.settings.lastReleaseNotesVersionSeen, "2.4.0");
});

test("migrateSettings preserves the locally selected recording directory", () => {
  const result = migrateSettings({
    ...defaultSettings,
    recordingSaveDirectory: " D:\\Friends\\Voice Records ",
  });

  assert.equal(result.settings.recordingSaveDirectory, "D:\\Friends\\Voice Records");
});

test("legacy sample-rate preferences are removed because microphone processing is fixed at 48 kHz", () => {
  for (const preferredSampleRate of ["auto", "32000", "44100", "48000"]) {
    const result = migrateSettings({
      ...defaultSettings,
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION - 1,
      preferredSampleRate,
    });

    assert.equal("preferredSampleRate" in result.settings, false);
    assert.equal(result.settings.settingsSchemaVersion, SETTINGS_SCHEMA_VERSION);
    assert.equal(result.migrated, true);
  }
});

test("provider-owned profile identities survive settings migration and malformed ids are repaired", () => {
  const profileId = "9df995df-3724-4c85-a8ae-47278368d380";
  const cloudBaseProfileId = "cloudbase-user_8d61a098d28d4cfe";
  const preserved = migrateSettings({ ...defaultSettings, profileId });
  const cloudBasePreserved = migrateSettings({
    ...defaultSettings,
    profileId: cloudBaseProfileId,
  });
  const repaired = migrateSettings({ ...defaultSettings, profileId: "invalid profile id" });

  assert.equal(preserved.settings.profileId, profileId);
  assert.equal(cloudBasePreserved.settings.profileId, cloudBaseProfileId);
  assert.notEqual(repaired.settings.profileId, "invalid profile id");
  assert.match(
    repaired.settings.profileId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
});

test("legacy uploaded avatar profiles are reset without clearing channel server settings", () => {
  const result = migrateSettings({
    nickname: "阿北",
    avatarPath: "C:/legacy/avatar.png",
    hasCompletedProfileSetup: true,
    relayServerUrl: "wss://voice.example.com",
    settingsSchemaVersion: 5,
  });

  assert.equal(result.settings.avatarPath, undefined);
  assert.equal(result.settings.hasCompletedProfileSetup, false);
  assert.equal(result.settings.relayServerUrl, "wss://voice.example.com/");
});

test("migrateSettings normalizes relay server urls for non-technical users", () => {
  assert.equal(
    migrateSettings({ relayServerUrl: "ws://118.25.103.107:43821/" }).settings.relayServerUrl,
    "wss://118.25.103.107/",
  );
  assert.equal(
    migrateSettings({ relayServerUrl: "ws://118.25.103.107:43821/?token=custom" }).settings
      .relayServerUrl,
    "ws://118.25.103.107:43821/?token=custom",
  );
  assert.equal(
    migrateSettings({ relayServerUrl: "1.2.3.4:43821" }).settings.relayServerUrl,
    "ws://1.2.3.4:43821/",
  );
  assert.equal(
    migrateSettings({ relayServerUrl: "http://1.2.3.4:43821/health" }).settings.relayServerUrl,
    "ws://1.2.3.4:43821/",
  );
  assert.equal(
    migrateSettings({ relayServerUrl: "https://relay.example.com" }).settings.relayServerUrl,
    "wss://relay.example.com/",
  );
});

test("screen sharing migration drops obsolete quality, audio, and visual settings", () => {
  const migrated = migrateSettings({
    screenShareQuality: "clear" as never,
    isScreenShareSystemAudioEnabled: true,
    screenShareFitMode: "cover",
    reduceMotion: true,
    reduceTransparency: true,
    increaseContrast: true,
  });

  assert.equal("screenShareQuality" in migrated.settings, false);
  assert.equal("isScreenShareSystemAudioEnabled" in migrated.settings, false);
  assert.equal("screenShareFitMode" in migrated.settings, false);
  assert.equal("reduceMotion" in migrated.settings, false);
  assert.equal("reduceTransparency" in migrated.settings, false);
  assert.equal("increaseContrast" in migrated.settings, false);
});
