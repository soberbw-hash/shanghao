import type { RoomMember } from "@private-voice/shared";

interface MemberVolumeSettingsPort {
  getMemberVolumes: () => Record<string, number> | undefined;
  saveMemberVolumes: (volumes: Record<string, number>) => Promise<void>;
}

export const runtimeMemberVolumes = new Map<string, number>();
const pendingSaves = new Map<string, number>();
const pendingDeletes = new Set<string>();
let saveTimer: number | undefined;
let resetAppliedVolumes: (() => void) | undefined;
let settingsPort: MemberVolumeSettingsPort | undefined;

export const configureMemberVolumePersistence = (port: MemberVolumeSettingsPort): void => {
  settingsPort = port;
};

export const registerMemberVolumeReset = (apply: () => void): void => {
  resetAppliedVolumes = apply;
};

export const cancelPendingMemberVolumeSaves = (): void => {
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = undefined;
  pendingSaves.clear();
  pendingDeletes.clear();
};

export const resetRuntimeMemberVolumes = (): void => {
  cancelPendingMemberVolumeSaves();
  runtimeMemberVolumes.clear();
  resetAppliedVolumes?.();
};

export const applyDefaultMemberVolumes = (
  members: ReadonlyArray<Pick<RoomMember, "id" | "isLocal" | "isEmptySlot">>,
  apply: (peerId: string, volume: number) => void,
): void => {
  for (const member of members) {
    if (member.isLocal || member.isEmptySlot) continue;
    apply(member.id, 1);
  }
};

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
    const currentVolumes = settingsPort?.getMemberVolumes();
    if (!currentVolumes || !settingsPort) return;
    const nextMemberVolumes = { ...currentVolumes };
    for (const key of pendingDeletes) delete nextMemberVolumes[key];
    for (const [key, pendingVolume] of pendingSaves) nextMemberVolumes[key] = pendingVolume;
    pendingSaves.clear();
    pendingDeletes.clear();
    void settingsPort.saveMemberVolumes(nextMemberVolumes);
  }, 320);
};
