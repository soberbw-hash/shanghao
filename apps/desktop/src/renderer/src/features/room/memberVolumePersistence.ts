import { useSettingsStore } from "../../store/settingsStore";

export const runtimeMemberVolumes = new Map<string, number>();
const pendingSaves = new Map<string, number>();
const pendingDeletes = new Set<string>();
let saveTimer: number | undefined;

export const scheduleMemberVolumeSave = (
  storageKey: string,
  volume: number,
  legacyStorageKey?: string,
): void => {
  pendingSaves.set(storageKey, volume);
  if (legacyStorageKey && legacyStorageKey !== storageKey) pendingDeletes.add(legacyStorageKey);
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    const currentSettings = useSettingsStore.getState().settings;
    if (!currentSettings) return;
    const nextMemberVolumes = { ...currentSettings.memberVolumes };
    for (const key of pendingDeletes) delete nextMemberVolumes[key];
    for (const [key, pendingVolume] of pendingSaves) nextMemberVolumes[key] = pendingVolume;
    pendingSaves.clear();
    pendingDeletes.clear();
    void useSettingsStore.getState().saveSettings({ memberVolumes: nextMemberVolumes });
  }, 320);
};
