const MAX_SIGNAL_GAME_NAME_LENGTH = 64;

export const normalizePresenceGameName = (value?: string): string | undefined => {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  const truncated = normalized.slice(0, MAX_SIGNAL_GAME_NAME_LENGTH);
  return /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
};
