import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";

import type { DailyRoomReport } from "@private-voice/shared";

type DailyRoomId = DailyRoomReport["roomId"];

interface PersistedDailyRoomReports {
  version: 1;
  rooms: Partial<Record<DailyRoomId, Record<string, DailyRoomReport>>>;
}

interface ActiveRoomState {
  count: number;
  activeSince?: number;
}

const EMPTY_REPORTS: PersistedDailyRoomReports = { version: 1, rooms: {} };
const RETAIN_DAYS = 14;

export const getShanghaiDate = (timestamp = Date.now()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);

export const shiftShanghaiDate = (date: string, days: number): string => {
  const base = Date.parse(`${date}T12:00:00+08:00`);
  return getShanghaiDate(base + days * 86_400_000);
};

const isRoomId = (value: string): value is DailyRoomId => value === "main" || value === "side";

const createEmptyReport = (roomId: DailyRoomId, date: string): DailyRoomReport => ({
  roomId,
  date,
  hadActivity: false,
  participantCount: 0,
  participantNicknames: [],
  activeDurationMs: 0,
  peakConcurrent: 0,
  messageCount: 0,
  screenShareCount: 0,
  games: [],
});

const sanitizeReport = (value: unknown, roomId: DailyRoomId, date: string): DailyRoomReport => {
  const source = value && typeof value === "object" ? (value as Partial<DailyRoomReport>) : {};
  return {
    ...createEmptyReport(roomId, date),
    hadActivity: source.hadActivity === true,
    participantCount: Math.max(0, Math.min(100, Number(source.participantCount) || 0)),
    participantNicknames: Array.isArray(source.participantNicknames)
      ? source.participantNicknames
          .filter((name): name is string => typeof name === "string")
          .slice(0, 100)
      : [],
    activeDurationMs: Math.max(0, Number(source.activeDurationMs) || 0),
    peakConcurrent: Math.max(0, Math.min(5, Number(source.peakConcurrent) || 0)),
    messageCount: Math.max(0, Number(source.messageCount) || 0),
    screenShareCount: Math.max(0, Number(source.screenShareCount) || 0),
    games: Array.isArray(source.games)
      ? source.games
          .filter((game) => game && typeof game.name === "string")
          .map((game) => ({
            name: game.name.slice(0, 64),
            participantCount: Math.max(1, Math.min(5, Number(game.participantCount) || 1)),
          }))
          .slice(0, 20)
      : [],
    lastExit:
      source.lastExit &&
      typeof source.lastExit.nickname === "string" &&
      typeof source.lastExit.at === "string"
        ? { nickname: source.lastExit.nickname.slice(0, 32), at: source.lastExit.at }
        : undefined,
    roomId,
    date,
  };
};

export class DailyRoomReportStore {
  private reports: PersistedDailyRoomReports = structuredClone(EMPTY_REPORTS);
  private readonly activeRooms = new Map<DailyRoomId, ActiveRoomState>();
  private readonly gamesByDay = new Map<string, Map<string, Set<string>>>();
  private readonly sharingPeers = new Set<string>();
  private writeQueue = Promise.resolve();

  private constructor(
    private readonly filePath?: string,
    private readonly log?: (message: string, context?: Record<string, unknown>) => void,
  ) {}

  static async create(
    filePath?: string,
    log?: (message: string, context?: Record<string, unknown>) => void,
  ): Promise<DailyRoomReportStore> {
    const store = new DailyRoomReportStore(filePath?.trim() || undefined, log);
    await store.load();
    return store;
  }

  getHistory(roomId: DailyRoomId, now = Date.now()): DailyRoomReport[] {
    this.closeActiveTime(roomId, now, false);
    const today = getShanghaiDate(now);
    return Array.from({ length: RETAIN_DAYS }, (_, index) =>
      shiftShanghaiDate(today, -(index + 1)),
    ).map((date) => sanitizeReport(this.reports.rooms[roomId]?.[date], roomId, date));
  }

  recordJoin(
    roomIdValue: string,
    peerId: string,
    nickname: string,
    concurrent: number,
    now = Date.now(),
  ): void {
    if (!isRoomId(roomIdValue)) return;
    const report = this.getMutableReport(roomIdValue, now);
    if (!report.participantNicknames.includes(nickname))
      report.participantNicknames.push(nickname.slice(0, 32));
    report.participantCount = report.participantNicknames.length;
    report.peakConcurrent = Math.max(report.peakConcurrent, concurrent);
    report.hadActivity = true;
    const active = this.activeRooms.get(roomIdValue) ?? { count: 0 };
    if (active.count === 0) active.activeSince = now;
    active.count = concurrent;
    this.activeRooms.set(roomIdValue, active);
    this.queueWrite();
  }

  recordLeave(
    roomIdValue: string,
    peerId: string,
    nickname: string,
    concurrent: number,
    now = Date.now(),
  ): void {
    if (!isRoomId(roomIdValue)) return;
    const report = this.getMutableReport(roomIdValue, now);
    report.hadActivity = true;
    report.lastExit = { nickname: nickname.slice(0, 32), at: new Date(now).toISOString() };
    this.sharingPeers.delete(`${roomIdValue}:${peerId}`);
    const active = this.activeRooms.get(roomIdValue) ?? { count: concurrent };
    active.count = concurrent;
    if (concurrent === 0 && active.activeSince) {
      report.activeDurationMs += Math.max(0, now - active.activeSince);
      active.activeSince = undefined;
    }
    this.activeRooms.set(roomIdValue, active);
    this.queueWrite();
  }

  recordMessage(roomIdValue: string, now = Date.now()): void {
    if (!isRoomId(roomIdValue)) return;
    const report = this.getMutableReport(roomIdValue, now);
    report.messageCount += 1;
    report.hadActivity = true;
    this.queueWrite();
  }

  recordGame(
    roomIdValue: string,
    peerId: string,
    gameName: string | undefined,
    now = Date.now(),
  ): void {
    if (!isRoomId(roomIdValue) || !gameName) return;
    const report = this.getMutableReport(roomIdValue, now);
    const key = `${roomIdValue}:${report.date}`;
    const dayGames = this.gamesByDay.get(key) ?? new Map<string, Set<string>>();
    const players = dayGames.get(gameName) ?? new Set<string>();
    players.add(peerId);
    dayGames.set(gameName, players);
    this.gamesByDay.set(key, dayGames);
    report.games = [...dayGames].map(([name, peers]) => ({ name, participantCount: peers.size }));
    report.hadActivity = true;
    this.queueWrite();
  }

  recordScreenShare(
    roomIdValue: string,
    peerId: string,
    isSharing: boolean,
    now = Date.now(),
  ): void {
    if (!isRoomId(roomIdValue)) return;
    const key = `${roomIdValue}:${peerId}`;
    if (isSharing && !this.sharingPeers.has(key)) {
      this.sharingPeers.add(key);
      const report = this.getMutableReport(roomIdValue, now);
      report.screenShareCount += 1;
      report.hadActivity = true;
      this.queueWrite();
    } else if (!isSharing) {
      this.sharingPeers.delete(key);
    }
  }

  async flush(): Promise<void> {
    for (const roomId of ["main", "side"] as const) this.closeActiveTime(roomId, Date.now(), true);
    await this.writeQueue;
  }

  private getMutableReport(roomId: DailyRoomId, now: number): DailyRoomReport {
    const date = getShanghaiDate(now);
    const roomReports = (this.reports.rooms[roomId] ??= {});
    const report = (roomReports[date] ??= createEmptyReport(roomId, date));
    this.prune(roomId, date);
    return report;
  }

  private closeActiveTime(roomId: DailyRoomId, now: number, stop: boolean): void {
    const active = this.activeRooms.get(roomId);
    if (!active?.activeSince) return;
    const report = this.getMutableReport(roomId, now);
    report.activeDurationMs += Math.max(0, now - active.activeSince);
    active.activeSince = stop ? undefined : now;
    this.queueWrite();
  }

  private prune(roomId: DailyRoomId, today: string): void {
    const roomReports = this.reports.rooms[roomId];
    if (!roomReports) return;
    const oldest = shiftShanghaiDate(today, -RETAIN_DAYS);
    for (const date of Object.keys(roomReports)) {
      if (date < oldest) delete roomReports[date];
    }
  }

  private async load(): Promise<void> {
    if (!this.filePath) return;
    for (const candidate of [this.filePath, this.getBackupPath()]) {
      try {
        const parsed = JSON.parse(
          (await readFile(candidate, "utf8")).replace(/^\uFEFF/, ""),
        ) as PersistedDailyRoomReports;
        if (!parsed?.rooms || typeof parsed.rooms !== "object")
          throw new Error("invalid_daily_room_reports");
        this.reports = { version: 1, rooms: {} };
        for (const roomId of ["main", "side"] as const) {
          const source = parsed.rooms[roomId];
          if (!source || typeof source !== "object") continue;
          this.reports.rooms[roomId] = Object.fromEntries(
            Object.entries(source).map(([date, value]) => [
              date,
              sanitizeReport(value, roomId, date),
            ]),
          );
        }
        return;
      } catch (error) {
        this.log?.("daily room reports candidate unavailable", {
          source: candidate,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private queueWrite(): void {
    if (!this.filePath) return;
    const snapshot = JSON.stringify(this.reports, null, 2);
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        const temporaryPath = `${this.filePath}.tmp`;
        await mkdir(dirname(this.filePath!), { recursive: true });
        await copyFile(this.filePath!, this.getBackupPath()).catch(() => undefined);
        await unlink(temporaryPath).catch(() => undefined);
        await writeFile(temporaryPath, snapshot, { encoding: "utf8", flag: "wx" });
        await rename(temporaryPath, this.filePath!);
      })
      .catch((error) => this.log?.("daily room reports write failed", { error: String(error) }));
  }

  private getBackupPath(): string {
    const parsed = parse(this.filePath!);
    return join(parsed.dir, `${parsed.name}.backup${parsed.ext || ".json"}`);
  }
}
