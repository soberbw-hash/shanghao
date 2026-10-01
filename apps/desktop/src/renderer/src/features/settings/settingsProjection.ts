import type { AppSettings } from "@private-voice/shared";

/** Select only the settings a view consumes; pair with useShallow at the subscription. */
export const settingsFields =
  <K extends keyof AppSettings>(...fields: readonly K[]) =>
  ({ settings }: { settings?: AppSettings }): Pick<AppSettings, K> | undefined =>
    settings
      ? (Object.fromEntries(fields.map((field) => [field, settings[field]])) as Pick<
          AppSettings,
          K
        >)
      : undefined;

export const selectAppProfileSettings = settingsFields(
  "profileId",
  "nickname",
  "hasCompletedProfileSetup",
  "accountAvatarPresetId",
  "avatarPath",
  "avatarId",
);
export const selectCollectionSettings = settingsFields(
  "collectionViewedAtByRoom",
  "lastCollectionViewedAt",
  "hasInitializedCollectionReadState",
);
export const selectOverlaySettings = settingsFields(
  "hasCompletedProfileSetup",
  "lastReleaseNotesVersionSeen",
  "lastDailyRoomReportSeen",
);
