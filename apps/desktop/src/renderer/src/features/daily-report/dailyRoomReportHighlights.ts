import type { DailyRoomReport } from "@private-voice/shared";

export interface DailyRoomReportHighlight {
  id: string;
  value: string;
  detail?: string;
}

const aggregateGames = (report: DailyRoomReport): Array<[string, number]> => {
  const games = new Map<string, number>();
  for (const activity of report.gameActivities ?? []) {
    games.set(activity.gameName, (games.get(activity.gameName) ?? 0) + activity.durationMs);
  }
  return [...games].sort((left, right) => right[1] - left[1]);
};

export const hasMeaningfulDailyRoomGameData = (report: DailyRoomReport): boolean => {
  const trackedDurationMs = aggregateGames(report).reduce(
    (total, [, durationMs]) => total + durationMs,
    0,
  );
  if (trackedDurationMs < 5 * 60_000) return false;
  if (report.activeDurationMs < 8 * 60 * 60_000) return true;
  // Very long rooms with only a tiny game fragment are usually legacy reports
  // produced before partial member updates stopped truncating game sessions.
  return trackedDurationMs / Math.max(1, report.activeDurationMs) >= 0.05;
};

export const buildDailyRoomReportFacts = (report: DailyRoomReport): string[] => {
  const mainGame = hasMeaningfulDailyRoomGameData(report)
    ? aggregateGames(report)[0]?.[0]
    : undefined;
  const minutes = Math.floor(report.activeDurationMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const duration = [hours && `${hours} 小时`, minutes % 60 && `${minutes % 60} 分钟`]
    .filter(Boolean)
    .join(" ");
  return [
    duration ? `房间活跃 ${duration}` : undefined,
    report.participantCount > 0 ? `${report.participantCount} 人来过` : undefined,
    mainGame ? `检测到《${mainGame}》` : undefined,
    report.messageCount > 0 ? `${report.messageCount} 条消息` : undefined,
    report.screenShareCount > 0 ? `${report.screenShareCount} 次屏幕分享` : undefined,
  ].filter((fact): fact is string => Boolean(fact));
};

export const buildDailyRoomReportHighlights = (
  report: DailyRoomReport,
): DailyRoomReportHighlight[] => {
  const lines =
    report.commentaryVersion === 2
      ? (report.commentary
          ?.split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean) ?? [])
      : [];
  return [...new Set(lines)]
    .slice(0, 3)
    .map((value, index) => ({ id: `overview-${index}`, value }));
};
