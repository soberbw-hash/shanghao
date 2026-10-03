import type { DailyRoomReport } from "@private-voice/shared";

export interface DailyRoomReportHighlight {
  id: string;
  label: string;
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

const resolveRoomTitle = (report: DailyRoomReport, mainGameDurationMs: number): string => {
  if (mainGameDurationMs >= 4 * 60 * 60_000) return "长线开黑局";
  if (report.activeDurationMs >= 12 * 60 * 60_000) return "从早开到夜";
  if (report.peakConcurrent >= 4) return "开黑小分队";
  if (report.peakConcurrent >= 3) return "三人小队成型";
  if (mainGameDurationMs >= 60 * 60_000) return "认真开了一局";
  return "好友碰头日";
};

export const buildDailyRoomReportNarrative = (report: DailyRoomReport): string => {
  const roomName =
    report.roomName ??
    (report.roomId === "side" ? "二号房" : report.roomId === "main" ? "一号房" : "房间");
  const lines = [`昨天${roomName}有 ${report.participantCount} 位朋友来过。`];
  const mainGame = hasMeaningfulDailyRoomGameData(report) ? aggregateGames(report)[0] : undefined;
  if (mainGame?.[1]) {
    lines[0] += `大家主要玩了《${mainGame[0]}》。`;
  }
  const recap = report.recordingRecaps?.at(-1);
  const summary = recap?.summary.filter((line) => line.trim()).slice(0, 2);
  if (summary?.length) lines.push(...summary);
  else if (report.lastExit)
    lines.push(`${report.lastExit.nickname} 是最后离开的那位，负责给昨天收个尾。`);
  return lines.join("\n");
};

export const buildDailyRoomReportHighlights = (
  report: DailyRoomReport,
): DailyRoomReportHighlight[] => {
  const result: DailyRoomReportHighlight[] = [];
  const recaps = [...(report.recordingRecaps ?? [])].reverse();
  const recap = recaps[0];
  if (recap && !recap.highlights.length && !recap.funnyMoments.length) {
    result.push({
      id: "recording-summary",
      label: "昨晚聊了什么",
      value: recap.summary[0] ?? "录音整理",
      detail: recap.description,
    });
  }
  const seen = new Set<string>();
  for (const item of recaps.flatMap((entry) => [
    ...entry.funnyMoments.map((moment) => ({ moment, label: "昨晚的笑点" })),
    ...entry.highlights.map((moment) => ({ moment, label: "值得记住" })),
  ])) {
    const { moment, label } = item;
    const identity = `${moment.title.trim()}\n${moment.description.trim()}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push({
      id: `recording-recap-${result.length}`,
      label,
      value: moment.title,
      detail: moment.description,
    });
    if (result.length >= 3) break;
  }
  const mainGame = hasMeaningfulDailyRoomGameData(report) ? aggregateGames(report)[0] : undefined;
  const plan = recaps
    .flatMap((entry) => entry.summary)
    .find((line) => /约好|约定|下次|下回|明天|周[一二三四五六日天].*(?:一起|开黑|上线)/.test(line));
  if (plan && !result.some((highlight) => highlight.value === plan || highlight.detail === plan)) {
    result.push({
      id: "next-plan",
      label: "下次约定",
      value: plan,
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
