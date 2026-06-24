export interface DailySessionStats {
  sessionId: string;
  minutes: number;
  maxOnline: number;
  messages: number;
  knocks: number;
  screenShares: number;
}

export interface DailyStatsSummary {
  date: string;
  sessions: number;
  minutes: number;
  maxOnline: number;
  messages: number;
  knocks: number;
  screenShares: number;
  recordedSessionIds: string[];
}

const DAILY_STATS_KEY = "shanghao:daily-stats";
const PENDING_DAILY_STATS_KEY = "shanghao:pending-daily-stats";

const localDateKey = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const createEmptySummary = (): DailyStatsSummary => ({
  date: localDateKey(),
  sessions: 0,
  minutes: 0,
  maxOnline: 0,
  messages: 0,
  knocks: 0,
  screenShares: 0,
  recordedSessionIds: [],
});

export const recordDailySession = (session: DailySessionStats): DailyStatsSummary => {
  let summary = createEmptySummary();
  try {
    const stored = JSON.parse(localStorage.getItem(DAILY_STATS_KEY) ?? "null") as
      | DailyStatsSummary
      | null;
    if (stored?.date === summary.date) summary = stored;
  } catch {
    summary = createEmptySummary();
  }

  if (summary.recordedSessionIds.includes(session.sessionId)) return summary;

  const next: DailyStatsSummary = {
    ...summary,
    sessions: summary.sessions + 1,
    minutes: summary.minutes + Math.max(1, Math.round(session.minutes)),
    maxOnline: Math.max(summary.maxOnline, session.maxOnline),
    messages: summary.messages + session.messages,
    knocks: summary.knocks + session.knocks,
    screenShares: summary.screenShares + session.screenShares,
    recordedSessionIds: [...summary.recordedSessionIds, session.sessionId].slice(-24),
  };
  localStorage.setItem(DAILY_STATS_KEY, JSON.stringify(next));
  localStorage.setItem(PENDING_DAILY_STATS_KEY, JSON.stringify(next));
  return next;
};

export const readPendingDailySummary = (): DailyStatsSummary | undefined => {
  try {
    const summary = JSON.parse(
      localStorage.getItem(PENDING_DAILY_STATS_KEY) ?? "null",
    ) as DailyStatsSummary | null;
    return summary?.date === localDateKey() ? summary : undefined;
  } catch {
    return undefined;
  }
};

export const dismissPendingDailySummary = (): void => {
  localStorage.removeItem(PENDING_DAILY_STATS_KEY);
};
