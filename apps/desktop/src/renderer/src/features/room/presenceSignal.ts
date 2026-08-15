const MAX_SIGNAL_GAME_NAME_LENGTH = 64;
const KK_PLATFORM_GAME_NAME = "KK 对战平台";

const normalizeKkPlatformAlias = (value: string): string => {
  const compact = value.toLowerCase().replaceAll(/\s+/g, "");
  if (
    compact.startsWith("kkrpg") ||
    compact.startsWith("kk对战平台") ||
    compact.startsWith("kk官方对战平台") ||
    value.startsWith("英雄三国")
  ) {
    return KK_PLATFORM_GAME_NAME;
  }
  return value;
};

export const normalizePresenceGameName = (value?: string): string | undefined => {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  const truncated = normalizeKkPlatformAlias(normalized).slice(0, MAX_SIGNAL_GAME_NAME_LENGTH);
  return /[\uD800-\uDBFF]$/.test(truncated) ? truncated.slice(0, -1) : truncated;
};

export const normalizePresenceGameIconDataUrl = (
  gameName: string | undefined,
  gameIconDataUrl: string | undefined,
): string | undefined =>
  normalizePresenceGameName(gameName) === KK_PLATFORM_GAME_NAME ? undefined : gameIconDataUrl;

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
