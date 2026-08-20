import type { DailyRoomReport } from "@private-voice/shared";

export interface DailyRoomReportHighlight {
  id: "presence" | "gaming" | "main-game" | "messages" | "sharing" | "late" | "peak";
  label: string;
  value: string;
  detail?: string;
}

const minutes = (milliseconds: number): number => Math.max(1, Math.round(milliseconds / 60_000));

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

export const buildDailyRoomReportHighlights = (
  report: DailyRoomReport,
): DailyRoomReportHighlight[] => {
  const participants = report.participants ?? [];
  const result: DailyRoomReportHighlight[] = [];
  const mostPresent = [...participants].sort(
    (left, right) => right.presenceDurationMs - left.presenceDurationMs,
  )[0];
  if (mostPresent?.presenceDurationMs) {
    result.push({
      id: "presence",
      label: "常驻选手",
      value: mostPresent.nickname,
      detail: `${minutes(mostPresent.presenceDurationMs)} 分钟`,
    });
  }
  const mostGaming = [...participants].sort(
    (left, right) => right.gameDurationMs - left.gameDurationMs,
  )[0];
  if (mostGaming?.gameDurationMs) {
    result.push({
      id: "gaming",
      label: "开黑王",
      value: mostGaming.nickname,
      detail: `${minutes(mostGaming.gameDurationMs)} 分钟`,
    });
  }
  const games = new Map<string, number>();
  for (const activity of report.gameActivities) {
    games.set(activity.gameName, (games.get(activity.gameName) ?? 0) + activity.durationMs);
  }
  const mainGame = [...games].sort((left, right) => right[1] - left[1])[0];
  if (mainGame?.[1]) {
    result.push({
      id: "main-game",
      label: "昨日主游",
      value: mainGame[0],
      detail: `${minutes(mainGame[1])} 分钟`,
    });
  }
  const mostMessages = [...participants].sort(
    (left, right) => right.messageCount - left.messageCount,
  )[0];
  if (mostMessages?.messageCount) {
    result.push({
      id: "messages",
      label: "打字选手",
      value: mostMessages.nickname,
      detail: `${mostMessages.messageCount} 条`,
    });
  }
  const mostSharing = [...participants].sort(
    (left, right) => right.screenShareDurationMs - left.screenShareDurationMs,
  )[0];
  if (mostSharing?.screenShareDurationMs) {
    result.push({
      id: "sharing",
      label: "投屏达人",
      value: mostSharing.nickname,
      detail: `${minutes(mostSharing.screenShareDurationMs)} 分钟`,
    });
  }
  const exitClock = clock(report.lastExit?.at);
  if (report.lastExit && exitClock) {
    const hour = Number(exitClock.slice(0, 2));
    if (hour < 6) {
      result.push({
        id: "late",
        label: "夜猫子",
        value: report.lastExit.nickname,
        detail: exitClock,
      });
    }
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
  return result;
};
