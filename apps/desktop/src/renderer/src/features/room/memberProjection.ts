import {
  MemberSpeakingState,
  type RoomMember,
  type AccountProfile,
  type AppSettings,
} from "@private-voice/shared";
import { clampMemberVolume } from "../audio/memberVolume";
import { ACCOUNT_AVATAR_PRESETS } from "../account/accountAvatarPresets";

/** Projects server membership and local controls without creating another presence authority. */
export const projectRoomMembers = (
  members: RoomMember[],
  {
    savedVolumes,
    audioState,
    profile,
    settings,
    runtimeMemberVolumes,
    saveLegacyVolume,
  }: {
    savedVolumes: Record<string, number>;
    audioState: { isMuted: boolean; isDeafened: boolean };
    profile?: AccountProfile;
    settings?: AppSettings;
    runtimeMemberVolumes: ReadonlyMap<string, number>;
    saveLegacyVolume: (profileId: string, volume: number, nickname: string) => void;
  },
): RoomMember[] => {
  const nicknameCounts = new Map<string, number>();
  for (const member of members) {
    nicknameCounts.set(member.nickname, (nicknameCounts.get(member.nickname) ?? 0) + 1);
  }
  return members.map((member) => {
    const storageKey = member.profileId || member.nickname;
    const legacyNicknameVolume =
      member.profileId &&
      nicknameCounts.get(member.nickname) === 1 &&
      savedVolumes[member.profileId] === undefined
        ? savedVolumes[member.nickname]
        : undefined;
    if (member.profileId && legacyNicknameVolume !== undefined) {
      saveLegacyVolume(member.profileId, legacyNicknameVolume, member.nickname);
    }
    const volume = clampMemberVolume(
      runtimeMemberVolumes.get(storageKey) ??
        savedVolumes[storageKey] ??
        legacyNicknameVolume ??
        member.volume ??
        1,
    );
    if (!member.isLocal) return { ...member, volume };

    return {
      ...member,
      // Presence packets may omit local account fields. Resolve the latest
      // account here so reconnect/speaking updates cannot replace it with “我”.
      nickname: profile?.displayName || member.nickname,
      avatarUrl:
        profile?.avatarUrl ||
        ACCOUNT_AVATAR_PRESETS.find(
          (preset) =>
            preset.id === (profile?.accountAvatarPresetId ?? settings?.accountAvatarPresetId),
        )?.source ||
        member.avatarUrl,
      volume,
      isMuted: audioState.isMuted,
      isDeafened: audioState.isDeafened,
      speakingState: audioState.isMuted
        ? MemberSpeakingState.Muted
        : member.speakingState === MemberSpeakingState.Muted
          ? MemberSpeakingState.Silent
          : member.speakingState,
    };
  });
};
