import type { AppSettings } from "@private-voice/shared";

export type SettingsSectionId =
  "account" | "general" | "audio" | "quickMessages" | "recordings" | "ai" | "about" | "diagnostics";

export const SETTINGS_SECTION_REQUEST_KEY = "shanghao.settings-section";

const settingsSectionIds: readonly SettingsSectionId[] = [
  "account",
  "general",
  "audio",
  "quickMessages",
  "recordings",
  "ai",
  "about",
  "diagnostics",
];

const lightweightSections = new Set<SettingsSectionId>([
  "account",
  "general",
  "audio",
  "quickMessages",
  "about",
]);

export const cacheSettingsSection = (
  current: ReadonlySet<SettingsSectionId>,
  nextSection: SettingsSectionId,
): Set<SettingsSectionId> => {
  const cached = new Set([...current].filter((section) => lightweightSections.has(section)));
  cached.add(nextSection);
  return cached;
};

export const readRequestedSettingsSection = (): SettingsSectionId | undefined => {
  const storedSection = window.sessionStorage.getItem(SETTINGS_SECTION_REQUEST_KEY);
  window.sessionStorage.removeItem(SETTINGS_SECTION_REQUEST_KEY);
  return settingsSectionIds.includes(storedSection as SettingsSectionId)
    ? (storedSection as SettingsSectionId)
    : undefined;
};

export const getInitialSettingsSection = (): SettingsSectionId => {
  const storedSection = readRequestedSettingsSection();
  if (storedSection) return storedSection;
  if (!import.meta.env.DEV) return "general";
  const requestedSection = new URLSearchParams(window.location.search).get("settingsSection");
  return settingsSectionIds.includes(requestedSection as SettingsSectionId)
    ? (requestedSection as SettingsSectionId)
    : "general";
};

export const settingsSectionSignature = (
  settings: AppSettings | undefined,
  section: SettingsSectionId,
): string => {
  if (!settings) return "loading";
  switch (section) {
    case "general":
      return JSON.stringify([
        settings.minimizeToTray,
        settings.isFriendOnlineNotificationEnabled,
        settings.weatherLocationMode,
        settings.weatherManualCity,
        settings.isSystemWeatherLocationEnabled,
      ]);
    case "audio":
      return JSON.stringify([
        settings.preferredInputDeviceId,
        settings.preferredOutputDeviceId,
        settings.recordingMarkerShortcut,
        settings.isAutoRecordOnJoinEnabled,
        settings.isRecordingAutoGameMarkerEnabled,
      ]);
    case "quickMessages":
      return JSON.stringify([settings.avatarId, settings.quickMessages]);
    case "recordings":
      return JSON.stringify([
        settings.recordingLibraryQuotaGb,
        settings.recordingSaveDirectory,
        settings.isRecordingWasteAutoCleanupEnabled,
        settings.aiAsrModel,
      ]);
    case "ai":
      return JSON.stringify([
        settings.aiAsrModel,
        settings.aiOrganizerProvider,
        settings.aiProcessingMode,
        settings.isAiAutoTranscribeEnabled,
        settings.isAiAutoOrganizeEnabled,
        settings.isAiAutoUploadEnabled,
      ]);
    case "diagnostics":
      return settings.relayServerUrl ?? "";
    default:
      return section;
  }
};
