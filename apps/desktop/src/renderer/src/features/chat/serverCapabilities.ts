const DAILY_ROOM_REPORTS_MIN_BUILD = "2026.08.12.1";
const RELIABLE_CHAT_ACK_MIN_BUILD = "2026.08.12.1";

const serverBuildAtLeast = (buildNumber: string | undefined, minimumBuild: string): boolean => {
  if (!buildNumber) return false;
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10));
  const current = parse(buildNumber);
  const minimum = parse(minimumBuild);
  if (current.some((part) => !Number.isFinite(part))) return false;
  for (let index = 0; index < Math.max(current.length, minimum.length); index += 1) {
    const currentPart = current[index] ?? 0;
    const minimumPart = minimum[index] ?? 0;
    if (currentPart !== minimumPart) return currentPart > minimumPart;
  }
  return true;
};

export const serverBuildSupportsDailyRoomReports = (buildNumber?: string): boolean =>
  serverBuildAtLeast(buildNumber, DAILY_ROOM_REPORTS_MIN_BUILD);

export const serverBuildSupportsReliableChat = (buildNumber?: string): boolean =>
  serverBuildAtLeast(buildNumber, RELIABLE_CHAT_ACK_MIN_BUILD);
