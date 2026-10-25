import type { GameSessionActivity, LeagueMode } from "@private-voice/shared";
import {
  clearLeagueConnectionCache,
  isLeagueProcess,
  leagueConnection,
  readLeagueEndpoint,
} from "./league-client-api";
import type { ProcessSnapshot } from "./game-detection";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export interface LeagueActivitySample {
  phase?: unknown;
  lobby?: unknown;
  session?: unknown;
  live?: unknown;
}
const modes: Record<number, LeagueMode> = {
  420: "排位赛",
  440: "灵活排位",
  450: "大乱斗",
  900: "无限火力",
  1900: "无限火力",
  400: "匹配赛",
  430: "匹配赛",
  480: "快速模式",
  490: "快速模式",
  700: "冠军杯赛",
  720: "大乱斗",
  1700: "斗魂竞技场",
  1090: "云顶之弈",
  1100: "云顶之弈",
  1130: "云顶之弈",
  1160: "云顶之弈",
};
const phases: Record<string, GameSessionActivity["phase"]> = {
  None: "client",
  Lobby: "lobby",
  CreatingLobby: "creating",
  Matchmaking: "matchmaking",
  ReadyCheck: "ready-check",
  ChampSelect: "champ-select",
  GameStart: "loading",
  InProgress: "in-game",
  Reconnect: "reconnecting",
  WaitingForStats: "post-game",
  PreEndOfGame: "post-game",
  EndOfGame: "post-game",
};

export function resolveLeagueActivity(
  sample: LeagueActivitySample,
  previous?: GameSessionActivity,
  now = Date.now(),
): GameSessionActivity | undefined {
  const lobby = object(sample.lobby),
    config = object(lobby.gameConfig),
    session = object(sample.session);
  const data = object(session.gameData),
    queue = object(data.queue),
    live = object(sample.live);
  const validTime =
    typeof live.gameTime === "number" &&
    Number.isFinite(live.gameTime) &&
    live.gameTime >= 0 &&
    live.gameTime <= 12 * 3600;
  const phase = phases[String(sample.phase)] ?? (validTime ? "in-game" : undefined);
  if (!phase) return;
  const queueId =
    typeof queue.id === "number"
      ? queue.id
      : typeof config.queueId === "number"
        ? config.queueId
        : undefined;
  const rawMode = String(queue.gameMode ?? data.gameMode ?? config.gameMode ?? live.gameMode ?? "");
  const mode: LeagueMode | undefined =
    config.isCustom === true
      ? "自定义"
      : queueId !== undefined && modes[queueId]
        ? modes[queueId]
        : (
            {
              ARAM: "大乱斗",
              URF: "无限火力",
              ARURF: "无限火力",
              CHERRY: "斗魂竞技场",
              TFT: "云顶之弈",
              PRACTICETOOL: "训练模式",
            } as Record<string, LeagueMode>
          )[rawMode];
  const result: GameSessionActivity = { source: "league", phase, ...(mode ? { mode } : {}) };
  if (
    phase === "lobby" &&
    Array.isArray(lobby.members) &&
    lobby.members.length > 0 &&
    lobby.members.length <= 16
  ) {
    result.partySize = lobby.members.length;
    const capacity = config.maxLobbySize;
    if (
      typeof capacity === "number" &&
      Number.isInteger(capacity) &&
      capacity >= result.partySize &&
      capacity <= 16
    )
      result.partyCapacity = capacity;
  }
  // Engine gameTime, not client launch/detection time. No timing is invented for a missing API.
  if (
    phase === "in-game" &&
    typeof live.gameTime === "number" &&
    Number.isFinite(live.gameTime) &&
    live.gameTime >= 0 &&
    live.gameTime <= 12 * 3600
  ) {
    const anchor = Math.round((now - live.gameTime * 1000) / 1000) * 1000;
    result.startedAt =
      previous?.phase === phase &&
      previous.mode === mode &&
      previous.startedAt !== undefined &&
      Math.abs(previous.startedAt - anchor) <= 3000
        ? previous.startedAt
        : anchor;
  }
  return result;
}

async function sampleLeagueActivity(
  processes: ProcessSnapshot[],
  signal: AbortSignal,
): Promise<LeagueActivitySample> {
  const connection = await leagueConnection(processes);
  if (signal.aborted) return {};
  if (!connection) return { live: await readLeagueEndpoint("/liveclientdata/gamestats", signal) };
  const phase = await readLeagueEndpoint("/lol-gameflow/v1/gameflow-phase", signal, connection);
  if (signal.aborted) return {};
  const [lobby, session, live] = await Promise.all([
    phase === "Lobby" ? readLeagueEndpoint("/lol-lobby/v2/lobby", signal, connection) : undefined,
    ["Matchmaking", "ChampSelect", "ReadyCheck", "GameStart", "InProgress"].includes(String(phase))
      ? readLeagueEndpoint("/lol-gameflow/v1/session", signal, connection)
      : undefined,
    phase === "InProgress" ? readLeagueEndpoint("/liveclientdata/gamestats", signal) : undefined,
  ]);
  return { phase, lobby, session, live };
}

/** Five-second loopback reads, independent of rendering and expensive process enumeration. */
export class LeagueActivityMonitor {
  private processes: ProcessSnapshot[] = [];
  private timer?: NodeJS.Timeout;
  private controller?: AbortController;
  private generation = 0;
  private last?: GameSessionActivity;
  private identity = "";
  constructor(
    private readonly changed: (activity: GameSessionActivity | undefined) => void,
    private readonly read = sampleLeagueActivity,
  ) {}
  watch(processes: ProcessSnapshot[]): void {
    const leagueProcesses = processes.filter(isLeagueProcess);
    const identity = JSON.stringify(
      leagueProcesses.map((process) => [process.ProcessId, process.Path]).sort(),
    );
    if (!leagueProcesses.length) {
      this.stop();
      return;
    }
    if (this.timer && identity === this.identity) {
      this.processes = leagueProcesses;
      return;
    }
    this.stop();
    this.identity = identity;
    this.processes = leagueProcesses;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 5000);
    this.timer.unref();
  }
  async refresh(): Promise<void> {
    if (this.controller || !this.processes.length) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const sample = await this.read(this.processes, controller.signal);
      if (generation !== this.generation || controller.signal.aborted) return;
      const next = resolveLeagueActivity(sample, this.last);
      if (JSON.stringify(next) !== JSON.stringify(this.last)) {
        this.last = next;
        this.changed(next);
      }
    } catch {
      if (generation === this.generation && !controller.signal.aborted && this.last) {
        this.last = undefined;
        this.changed(undefined);
      }
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }
  stop(): void {
    this.generation++;
    clearLeagueConnectionCache();
    this.controller?.abort();
    this.controller = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.processes = [];
    this.identity = "";
    if (this.last) {
      this.last = undefined;
      this.changed(undefined);
    }
  }
}
