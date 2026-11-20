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
  return [
    report.participantCount > 0 ? `${report.participantCount} 人来过` : undefined,
    mainGame ? `检测到《${mainGame}》` : undefined,
    report.messageCount > 0 ? `${report.messageCount} 条消息` : undefined,
    report.screenShareCount > 0 ? `${report.screenShareCount} 次屏幕分享` : undefined,
  ].filter((fact): fact is string => Boolean(fact));
};

export const buildDailyRoomReportHighlights = (
  report: DailyRoomReport,
): DailyRoomReportHighlight[] => {
  const recaps = [...(report.recordingRecaps ?? [])].reverse();
  const result: DailyRoomReportHighlight[] = [];
  const seen = new Set<string>();
  for (const moment of recaps.flatMap((entry) => [...entry.highlights, ...entry.funnyMoments])) {
    const value = moment.title.trim() || moment.description.trim();
    const detail = moment.description.trim();
    if (!value) continue;
    const identity = `${value}\n${detail}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push({
      id: `recording-recap-${result.length}`,
      value,
      detail: detail !== value ? detail : undefined,
    });
    if (result.length === 3) break;
  }
  if (result.length) return result;

  const distinctLines = (lines: string[]) => [
    ...new Set(lines.map((line) => line.trim()).filter(Boolean)),
  ];
  const commentary = distinctLines(report.commentary?.split(/\r?\n/) ?? []);
  const summaries = distinctLines(recaps.flatMap((recap) => recap.summary));
  const chronicle = distinctLines((report.chronicleRecaps ?? []).map((entry) => entry.text)).slice(
    -3,
  );
  const lines = commentary.length ? commentary : summaries.length ? summaries : chronicle;
  return lines.slice(0, 3).map((value, index) => ({ id: `recap-${index}`, value }));
};
