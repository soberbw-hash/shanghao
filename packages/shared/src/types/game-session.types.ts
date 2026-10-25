export const LEAGUE_MODES = [
  "排位赛",
  "灵活排位",
  "大乱斗",
  "无限火力",
  "斗魂竞技场",
  "匹配赛",
  "训练模式",
  "自定义",
  "云顶之弈",
  "快速模式",
  "冠军杯赛",
] as const;
export type LeagueMode = (typeof LEAGUE_MODES)[number];
export const GAME_SESSION_PHASES = [
  "client",
  "lobby",
  "creating",
  "matchmaking",
  "ready-check",
  "champ-select",
  "loading",
  "in-game",
  "reconnecting",
  "post-game",
] as const;
export interface GameSessionActivity {
  source: "league";
  phase: (typeof GAME_SESSION_PHASES)[number];
  mode?: LeagueMode;
  startedAt?: number;
  partySize?: number;
  partyCapacity?: number;
}

/** Wire data contains status only: never account names, champion data or local API credentials. */
export function isGameSessionActivity(value: unknown): value is GameSessionActivity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const integer = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 16;
  return (
    Object.keys(item).every((key) =>
      ["source", "phase", "mode", "startedAt", "partySize", "partyCapacity"].includes(key),
    ) &&
    item.source === "league" &&
    GAME_SESSION_PHASES.includes(item.phase as GameSessionActivity["phase"]) &&
    (item.mode === undefined || LEAGUE_MODES.includes(item.mode as LeagueMode)) &&
    (item.startedAt === undefined ||
      (typeof item.startedAt === "number" &&
        Number.isFinite(item.startedAt) &&
        item.startedAt > 0 &&
        item.startedAt < 1e14)) &&
    (item.partySize === undefined || integer(item.partySize)) &&
    (item.partyCapacity === undefined ||
      (integer(item.partyCapacity) &&
        integer(item.partySize) &&
        Number(item.partySize) <= Number(item.partyCapacity)))
  );
}

export function gameSessionLabel(session: GameSessionActivity, now = Date.now()): string {
  const party = session.partySize
    ? ` · ${session.partySize}${session.partyCapacity ? `/${session.partyCapacity}` : "人"}`
    : "";
  if (session.phase === "client") return "客户端中";
  if (session.phase === "lobby") return `房间中${party}`;
  if (session.phase === "creating") return "正在创建房间";
  if (session.phase === "matchmaking") return `${session.mode ?? "匹配"} · 排队中`;
  if (session.phase === "ready-check") return "已找到对局 · 等待确认";
  if (session.phase === "champ-select") return `${session.mode ?? "对局"} · 选择英雄中`;
  if (session.phase === "loading") return `${session.mode ?? "对局"} · 加载中`;
  if (session.phase === "reconnecting") return "正在重连对局";
  if (session.phase === "post-game") return "对局已结束";
  const elapsed = session.startedAt === undefined ? undefined : now - session.startedAt;
  return `${session.mode ?? "对局中"}${elapsed !== undefined && elapsed >= 0 && elapsed <= 12 * 3600_000 ? ` · ${Math.floor(elapsed / 60_000)} 分钟` : ""}`;
}
