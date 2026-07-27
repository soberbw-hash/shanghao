export const MEMBER_VOLUME_MIN = 0;
export const MEMBER_VOLUME_MAX = 2;
export const MEMBER_VOLUME_DEFAULT = 1;

export const clampMemberVolume = (volume: number): number => {
  if (!Number.isFinite(volume)) return MEMBER_VOLUME_DEFAULT;
  return Math.max(MEMBER_VOLUME_MIN, Math.min(MEMBER_VOLUME_MAX, volume));
};

export const memberVolumeToPercent = (volume: number): number =>
  Math.round(clampMemberVolume(volume) * 100);

export const toggleLocalMemberMute = (
  currentVolume: number,
  previousAudibleVolume: number,
): number => {
  if (clampMemberVolume(currentVolume) > 0.001) return MEMBER_VOLUME_MIN;
  const previousVolume = clampMemberVolume(previousAudibleVolume);
  return previousVolume > 0.001 ? previousVolume : MEMBER_VOLUME_DEFAULT;
};
