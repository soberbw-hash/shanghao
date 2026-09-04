import type { DailyRoomReport } from "@private-voice/shared";

export interface DailyRoomReportHighlight {
  id: string;
  label: string;
  value: string;
  detail?: string;
}

const formatDuration = (milliseconds: number): string => {
  const totalMinutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
};

const clock = (iso?: string): string | undefined => {
  if (!iso) return undefined;
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(timestamp);
};

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

const resolveRoomTitle = (report: DailyRoomReport, mainGameDurationMs: number): string => {
  if (mainGameDurationMs >= 4 * 60 * 60_000) return "长线开黑局";
  if (report.activeDurationMs >= 12 * 60 * 60_000) return "从早开到夜";
  if (report.peakConcurrent >= 4) return "满员小分队";
  if (report.peakConcurrent >= 3) return "三人小队成型";
  if (mainGameDurationMs >= 60 * 60_000) return "认真开了一局";
  return "好友碰头日";
};

export const buildDailyRoomReportNarrative = (report: DailyRoomReport): string => {
  const roomName = report.roomId === "side" ? "二号房" : "一号房";
  const lines = [
    `昨天${roomName}一共在线 ${formatDuration(report.activeDurationMs)}，${report.participantCount} 位朋友来过。`,
  ];
  const mainGame = hasMeaningfulDailyRoomGameData(report) ? aggregateGames(report)[0] : undefined;
  const peakClock = clock(report.peakConcurrentAt);
  if (mainGame?.[1]) {
    lines.push(`现有游戏记录里《${mainGame[0]}》最长，累计 ${formatDuration(mainGame[1])}。`);
  }
  if (report.peakConcurrent > 1) {
    lines.push(
      peakClock
        ? `${peakClock} 最热闹，最高 ${report.peakConcurrent} 人同时在线。`
        : `最高 ${report.peakConcurrent} 人同时在线。`,
    );
  }
  return lines.join("\n");
};

export const buildDailyRoomReportHighlights = (
  report: DailyRoomReport,
): DailyRoomReportHighlight[] => {
  const result: DailyRoomReportHighlight[] = [];
  const recap = report.recordingRecaps?.at(-1);
  for (const [index, moment] of [...(recap?.funnyMoments ?? []), ...(recap?.highlights ?? [])]
    .slice(0, 2)
    .entries()) {
    result.push({
      id: `recording-recap-${index}`,
      label: index === 0 && recap?.funnyMoments.length ? "昨晚最好笑" : "值得回听",
      value: moment.title,
      detail: moment.description,
    });
  }
  const mainGame = hasMeaningfulDailyRoomGameData(report) ? aggregateGames(report)[0] : undefined;
  if (mainGame?.[1]) {
    result.push({
      id: "main-game",
      label: "昨日主游",
      value: mainGame[0],
      detail: `累计 ${formatDuration(mainGame[1])}`,
    });
  }

  const peakClock = clock(report.peakConcurrentAt);
  if (report.peakConcurrent > 1 && peakClock) {
    result.push({
      id: "peak",
      label: "最热闹时刻",
      value: peakClock,
      detail: `${report.peakConcurrent} 人同时在线`,
    });
  }

  if (!recap) {
    result.push({
      id: "room-title",
      label: "昨日称号",
      value: resolveRoomTitle(report, mainGame?.[1] ?? 0),
      detail: report.activeDurationMs >= 12 * 60 * 60_000 ? "这间房昨天几乎没熄灯" : undefined,
    });
  }
  return result;
};
