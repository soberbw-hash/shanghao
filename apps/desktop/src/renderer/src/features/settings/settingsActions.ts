import type { AppSettings } from "@private-voice/shared";

import { useSettingsStore } from "../../store/settingsStore";

export const persistSettingsPatch = async (patch: Partial<AppSettings>): Promise<void> => {
  await useSettingsStore.getState().saveSettings(patch);
};
