const MAX_SIGNAL_GAME_NAME_LENGTH = 64;

export const normalizePresenceGameName = (value?: string): string | undefined => {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  const truncated = normalized.slice(0, MAX_SIGNAL_GAME_NAME_LENGTH);
  return /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
};

export const resolvePresenceGameNameUpdate = (
  currentGameName: string | undefined,
  incomingGameName: string | undefined,
  incomingActivity: string | undefined,
): string | undefined => {
  if (incomingGameName === "") return undefined;
  if (incomingGameName !== undefined) return normalizePresenceGameName(incomingGameName);

  // Older servers omitted an explicit empty gameName from the broadcast. An
  // activity update away from gaming is enough evidence to clear that stale value.
  if (incomingActivity !== undefined && incomingActivity !== "gaming") return undefined;
  return currentGameName;
};
