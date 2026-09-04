import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, parse } from "node:path";

import type {
  DailyRoomParticipantSummary,
  DailyRoomRecordingRecap,
  DailyRoomReport,
} from "@private-voice/shared";

type DailyRoomId = DailyRoomReport["roomId"];

interface PersistedDailyRoomReports {
  version: 2 | 3;
  rooms: Partial<Record<DailyRoomId, Record<string, DailyRoomReport>>>;
  participants: Partial<Record<DailyRoomId, Record<string, Record<string, string>>>>;
  gameParticipants: Partial<Record<DailyRoomId, Record<string, Record<string, string[]>>>>;
}

interface ActiveRoomState {
  count: number;
  activeSince?: number;
  participants: Map<string, string>;
}

interface ActiveGameState {
  identityId: string;
  gameName: string;
  nickname: string;
  startedAt: number;
}

interface ActiveParticipantState {
  identityId: string;
  nickname: string;
  startedAt: number;
}

interface ActiveShareState {
  identityId: string;
  nickname: string;
  startedAt: number;
}

const EMPTY_REPORTS: PersistedDailyRoomReports = {
  version: 3,
  rooms: {},
  participants: {},
  gameParticipants: {},
};
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
  schemaVersion: 1,
  revision: 0,
  updatedAt: new Date(Date.parse(`${date}T00:00:00+08:00`)).toISOString(),
  roomId,
  date,
  hadActivity: false,
  participantCount: 0,
  participantNicknames: [],
  activeDurationMs: 0,
  peakConcurrent: 0,
  messageCount: 0,
  screenShareCount: 0,
  screenShareDurationMs: 0,
  games: [],
  gameActivities: [],
  participants: [],
});

const sanitizeParticipant = (value: unknown): DailyRoomParticipantSummary | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<DailyRoomParticipantSummary>;
  if (typeof source.identityId !== "string" || typeof source.nickname !== "string")
    return undefined;
  if (typeof source.firstSeenAt !== "string") return undefined;
  return {
    identityId: source.identityId.slice(0, 160),
    nickname: source.nickname.slice(0, 32),
    presenceDurationMs: Math.max(0, Number(source.presenceDurationMs) || 0),
    joinSessions: Math.max(0, Number(source.joinSessions) || 0),
    gameDurationMs: Math.max(0, Number(source.gameDurationMs) || 0),
    messageCount: Math.max(0, Number(source.messageCount) || 0),
    screenShareCount: Math.max(0, Number(source.screenShareCount) || 0),
    screenShareDurationMs: Math.max(0, Number(source.screenShareDurationMs) || 0),
    firstSeenAt: source.firstSeenAt,
    lastExitAt: typeof source.lastExitAt === "string" ? source.lastExitAt : undefined,
  };
};

const uniqueNicknames = (values: unknown[]): string[] => {
  const result = new Map<string, string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const nickname = value.trim().slice(0, 32);
    if (!nickname) continue;
    const key = nickname.toLocaleLowerCase("zh-CN");
    if (!result.has(key)) result.set(key, nickname);
  }
  return [...result.values()].slice(0, 100);
};

const normalizeCommentary = (value: string): string | undefined => {
  const lines = value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
  if (!lines.length) return undefined;
  return [...lines.join("\n")].slice(0, 180).join("");
};

const isRichCommentary = (value: string | undefined): boolean =>
  Boolean(value && value.split(/\r?\n/).filter((line) => line.trim()).length >= 2);

const sanitizeRecordingRecap = (value: unknown): DailyRoomRecordingRecap | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Partial<DailyRoomRecordingRecap>;
  const recordingId =
    typeof source.recordingId === "string" ? source.recordingId.slice(0, 180) : "";
  const uploadedAt = typeof source.uploadedAt === "string" ? source.uploadedAt : "";
  const description =
    typeof source.description === "string" ? source.description.trim().slice(0, 800) : "";
  if (!recordingId || !description || !Number.isFinite(Date.parse(uploadedAt))) return undefined;
  const moments = (items: unknown, limit: number) =>
    (Array.isArray(items) ? items : [])
      .filter(
        (item) =>
          item &&
          typeof item.title === "string" &&
          typeof item.description === "string" &&
          Number.isFinite(Number(item.startMs)) &&
          Number.isFinite(Number(item.endMs)),
      )
      .map((item) => ({
        title: String(item.title).trim().slice(0, 80),
        description: String(item.description).trim().slice(0, 320),
        startMs: Math.max(0, Number(item.startMs)),
        endMs: Math.max(Number(item.startMs), Number(item.endMs)),
      }))
      .filter((item) => item.title && item.description)
      .slice(0, limit);
  return {
    recordingId,
    uploadedAt,
    description,
    summary: (Array.isArray(source.summary) ? source.summary : [])
      .map((item) => String(item).trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 8),
    highlights: moments(source.highlights, 8),
    funnyMoments: moments(source.funnyMoments, 8),
    participantNicknames: uniqueNicknames(
      Array.isArray(source.participantNicknames) ? source.participantNicknames : [],
    ).slice(0, 20),
    keywords: (Array.isArray(source.keywords) ? source.keywords : [])
      .map((item) => String(item).trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 24),
  };
};

const sanitizeReport = (value: unknown, roomId: DailyRoomId, date: string): DailyRoomReport => {
  const source = value && typeof value === "object" ? (value as Partial<DailyRoomReport>) : {};
  const participantNicknames = uniqueNicknames(
    Array.isArray(source.participantNicknames) ? source.participantNicknames : [],
  );
  return {
    ...createEmptyReport(roomId, date),
    schemaVersion: 1,
    revision: Math.max(0, Number(source.revision) || 0),
    updatedAt:
      typeof source.updatedAt === "string"
        ? source.updatedAt
        : new Date(Date.parse(`${date}T00:00:00+08:00`)).toISOString(),
    hadActivity: source.hadActivity === true,
    participantCount:
      participantNicknames.length ||
      Math.max(0, Math.min(100, Number(source.participantCount) || 0)),
    participantNicknames,
    commentary:
      typeof source.commentary === "string" ? normalizeCommentary(source.commentary) : undefined,
    activeDurationMs: Math.max(0, Number(source.activeDurationMs) || 0),
    peakConcurrent: Math.max(0, Math.min(5, Number(source.peakConcurrent) || 0)),
    messageCount: Math.max(0, Number(source.messageCount) || 0),
    screenShareCount: Math.max(0, Number(source.screenShareCount) || 0),
    screenShareDurationMs: Math.max(0, Number(source.screenShareDurationMs) || 0),
    games: Array.isArray(source.games)
      ? source.games
          .filter((game) => game && typeof game.name === "string")
          .map((game) => ({
            name: game.name.slice(0, 64),
            participantCount: Math.max(1, Math.min(5, Number(game.participantCount) || 1)),
          }))
          .slice(0, 20)
      : [],
    gameActivities: Array.isArray(source.gameActivities)
      ? source.gameActivities
          .filter(
            (activity) =>
              activity &&
              typeof activity.nickname === "string" &&
              typeof activity.gameName === "string",
          )
          .map((activity) => ({
            ...(typeof activity.identityId === "string"
              ? { identityId: activity.identityId.slice(0, 160) }
              : {}),
            nickname: activity.nickname.slice(0, 32),
            gameName: activity.gameName.slice(0, 64),
            durationMs: Math.max(0, Number(activity.durationMs) || 0),
          }))
          .slice(0, 100)
      : [],
    participants: Array.isArray(source.participants)
      ? source.participants
          .map(sanitizeParticipant)
          .filter((participant): participant is DailyRoomParticipantSummary => Boolean(participant))
          .slice(0, 100)
      : [],
    recordingRecaps: Array.isArray(source.recordingRecaps)
      ? source.recordingRecaps
          .map(sanitizeRecordingRecap)
          .filter((recap): recap is DailyRoomRecordingRecap => Boolean(recap))
          .slice(-6)
      : [],
    peakConcurrentAt:
      typeof source.peakConcurrentAt === "string" ? source.peakConcurrentAt : undefined,
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
  private readonly activeGames = new Map<string, ActiveGameState>();
  private readonly activeParticipants = new Map<string, ActiveParticipantState>();
  private readonly activeShares = new Map<string, ActiveShareState>();
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
    this.closeActiveParticipants(roomId, now, false);
    this.closeActiveGames(roomId, now, false);
    this.closeActiveShares(roomId, now, false);
    const today = getShanghaiDate(now);
    return Array.from({ length: RETAIN_DAYS }, (_, index) => shiftShanghaiDate(today, -(index + 1)))
      .map((date) => sanitizeReport(this.reports.rooms[roomId]?.[date], roomId, date))
      .filter((report) => report.hadActivity);
  }

  setCommentary(roomId: DailyRoomId, date: string, value: string, now = Date.now()): boolean {
    const report = this.reports.rooms[roomId]?.[date];
    if (!report || isRichCommentary(report.commentary)) return false;
    const commentary = normalizeCommentary(value);
    if (!commentary) return false;
    report.commentary = commentary;
    this.touch(report, now);
    return true;
  }

  publishRecordingRecap(
    roomIdValue: string,
    date: string,
    value: Omit<DailyRoomRecordingRecap, "uploadedAt">,
    now = Date.now(),
  ): { publishedAt: string; serverRevision: number } | undefined {
    if (!isRoomId(roomIdValue) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
    const reportTimestamp = Date.parse(`${date}T12:00:00+08:00`);
    const todayTimestamp = Date.parse(`${getShanghaiDate(now)}T12:00:00+08:00`);
    const ageDays = Math.round((todayTimestamp - reportTimestamp) / 86_400_000);
    if (!Number.isFinite(reportTimestamp) || ageDays < 0 || ageDays > RETAIN_DAYS) return undefined;
    const publishedAt = new Date(now).toISOString();
    const recap = sanitizeRecordingRecap({ ...value, uploadedAt: publishedAt });
    if (!recap) return undefined;
    const report = this.getMutableReport(roomIdValue, reportTimestamp);
    report.recordingRecaps = [
      ...(report.recordingRecaps ?? []).filter(
        (candidate) => candidate.recordingId !== recap.recordingId,
      ),
      recap,
    ].slice(-6);
    const recapCommentary = normalizeCommentary(
      [recap.description, ...recap.summary].filter(Boolean).slice(0, 3).join("\n"),
    );
    if (recapCommentary) report.commentary = recapCommentary;
    report.hadActivity = true;
    this.touch(report, now);
    return { publishedAt, serverRevision: report.revision ?? 0 };
  }

  recordJoin(
    roomIdValue: string,
    identityId: string,
    nickname: string,
    concurrent: number,
    now = Date.now(),
  ): void {
    if (!isRoomId(roomIdValue)) return;
    this.closeActiveTime(roomIdValue, now, false);
    const report = this.getMutableReport(roomIdValue, now);
    const active = this.activeRooms.get(roomIdValue) ?? {
      count: 0,
      participants: new Map<string, string>(),
    };
    active.participants.set(identityId, nickname.slice(0, 32));
    this.addParticipants(roomIdValue, report.date, active.participants);
    if (concurrent > report.peakConcurrent) {
      report.peakConcurrent = concurrent;
      report.peakConcurrentAt = new Date(now).toISOString();
    }
    report.hadActivity = true;
    const participantKey = `${roomIdValue}:${identityId}`;
    if (!this.activeParticipants.has(participantKey)) {
      this.activeParticipants.set(participantKey, {
        identityId,
        nickname: nickname.slice(0, 32),
        startedAt: now,
      });
      const participant = this.getParticipant(report, identityId, nickname, now);
      participant.joinSessions += 1;
    } else {
      this.activeParticipants.get(participantKey)!.nickname = nickname.slice(0, 32);
    }
    if (active.count === 0) active.activeSince = now;
    active.count = concurrent;
    this.activeRooms.set(roomIdValue, active);
    this.touch(report, now);
  }

  recordLeave(
    roomIdValue: string,
    identityId: string,
    nickname: string,
    concurrent: number,
    now = Date.now(),
  ): void {
    if (!isRoomId(roomIdValue)) return;
    this.closeActiveTime(roomIdValue, now, false);
    const report = this.getMutableReport(roomIdValue, now);
    report.hadActivity = true;
    report.lastExit = { nickname: nickname.slice(0, 32), at: new Date(now).toISOString() };
    this.closeActiveParticipant(roomIdValue, identityId, now, true);
    this.closeActiveGame(roomIdValue, identityId, now, true);
    this.closeActiveShare(roomIdValue, identityId, now, true);
    const active = this.activeRooms.get(roomIdValue) ?? {
      count: concurrent,
      participants: new Map<string, string>(),
    };
    active.participants.delete(identityId);
    active.count = concurrent;
    if (concurrent === 0 && active.activeSince) {
      report.activeDurationMs += Math.max(0, now - active.activeSince);
      active.activeSince = undefined;
    }
    this.activeRooms.set(roomIdValue, active);
    this.touch(report, now);
  }

  recordMessage(
    roomIdValue: string,
    identityIdOrNow?: string | number,
    nickname?: string,
    now = Date.now(),
  ): void {
    if (!isRoomId(roomIdValue)) return;
    const identityId = typeof identityIdOrNow === "string" ? identityIdOrNow : undefined;
    if (typeof identityIdOrNow === "number") now = identityIdOrNow;
    const report = this.getMutableReport(roomIdValue, now);
    report.messageCount += 1;
    report.hadActivity = true;
    if (identityId)
      this.getParticipant(report, identityId, nickname || "朋友", now).messageCount += 1;
    this.touch(report, now);
  }

  recordGame(
    roomIdValue: string,
    identityId: string,
    nickname: string,
    gameName: string | undefined,
    now = Date.now(),
  ): void {
    if (!isRoomId(roomIdValue)) return;
    const activeKey = `${roomIdValue}:${identityId}`;
    const active = this.activeGames.get(activeKey);
    const normalizedGameName = gameName?.trim().slice(0, 64) || undefined;
    const normalizedNickname = nickname.trim().slice(0, 32) || "朋友";
    if (active && active.gameName === normalizedGameName) {
      active.nickname = normalizedNickname;
      return;
    }
    if (active) this.closeActiveGame(roomIdValue, identityId, now, true);
    if (!normalizedGameName) return;
    const report = this.getMutableReport(roomIdValue, now);
    const key = `${roomIdValue}:${report.date}`;
    const dayGames = this.gamesByDay.get(key) ?? new Map<string, Set<string>>();
    const players = dayGames.get(normalizedGameName) ?? new Set<string>();
    players.add(identityId);
    dayGames.set(normalizedGameName, players);
    this.gamesByDay.set(key, dayGames);
    const roomGames = (this.reports.gameParticipants[roomIdValue] ??= {});
    const persistedDayGames = (roomGames[report.date] ??= {});
    persistedDayGames[normalizedGameName] = [...players];
    report.games = [...dayGames].map(([name, peers]) => ({ name, participantCount: peers.size }));
    report.hadActivity = true;
    this.activeGames.set(activeKey, {
      identityId,
      gameName: normalizedGameName,
      nickname: normalizedNickname,
      startedAt: now,
    });
    this.touch(report, now);
  }

  recordScreenShare(
    roomIdValue: string,
    identityId: string,
    isSharing: boolean,
    nicknameOrNow: string | number = "朋友",
    now = Date.now(),
  ): void {
    if (!isRoomId(roomIdValue)) return;
    const nickname =
      typeof nicknameOrNow === "string"
        ? nicknameOrNow
        : (this.activeParticipants.get(`${roomIdValue}:${identityId}`)?.nickname ?? "朋友");
    if (typeof nicknameOrNow === "number") now = nicknameOrNow;
    const key = `${roomIdValue}:${identityId}`;
    if (isSharing && !this.activeShares.has(key)) {
      this.activeShares.set(key, {
        identityId,
        nickname: nickname.slice(0, 32),
        startedAt: now,
      });
      const report = this.getMutableReport(roomIdValue, now);
      report.screenShareCount += 1;
      report.hadActivity = true;
      this.getParticipant(report, identityId, nickname, now).screenShareCount += 1;
      this.touch(report, now);
    } else if (!isSharing) {
      this.closeActiveShare(roomIdValue, identityId, now, true);
    }
  }

  async flush(): Promise<void> {
    const now = Date.now();
    for (const roomId of ["main", "side"] as const) {
      this.closeActiveTime(roomId, now, true);
      this.closeActiveParticipants(roomId, now, true);
      this.closeActiveGames(roomId, now, true);
      this.closeActiveShares(roomId, now, true);
    }
    await this.writeQueue;
  }

  private closeActiveGames(roomId: DailyRoomId, now: number, stop: boolean): void {
    for (const key of [...this.activeGames.keys()]) {
      if (key.startsWith(`${roomId}:`)) {
        this.closeActiveGame(roomId, key.slice(roomId.length + 1), now, stop);
      }
    }
  }

  private closeActiveParticipants(roomId: DailyRoomId, now: number, stop: boolean): void {
    for (const key of [...this.activeParticipants.keys()]) {
      if (key.startsWith(`${roomId}:`)) {
        this.closeActiveParticipant(roomId, key.slice(roomId.length + 1), now, stop);
      }
    }
  }

  private closeActiveParticipant(
    roomId: DailyRoomId,
    identityId: string,
    now: number,
    stop: boolean,
  ): void {
    const key = `${roomId}:${identityId}`;
    const active = this.activeParticipants.get(key);
    if (!active) return;
    let cursor = active.startedAt;
    while (cursor < now) {
      const date = getShanghaiDate(cursor);
      const nextDate = shiftShanghaiDate(date, 1);
      const segmentEnd = Math.min(now, Date.parse(`${nextDate}T00:00:00+08:00`));
      const report = this.getMutableReport(roomId, cursor);
      const participant = this.getParticipant(report, identityId, active.nickname, cursor);
      participant.presenceDurationMs += Math.max(0, segmentEnd - cursor);
      if (stop && segmentEnd === now) participant.lastExitAt = new Date(now).toISOString();
      report.hadActivity = true;
      this.touch(report, segmentEnd);
      cursor = segmentEnd;
    }
    if (stop) this.activeParticipants.delete(key);
    else active.startedAt = now;
  }

  private closeActiveShares(roomId: DailyRoomId, now: number, stop: boolean): void {
    for (const key of [...this.activeShares.keys()]) {
      if (key.startsWith(`${roomId}:`)) {
        this.closeActiveShare(roomId, key.slice(roomId.length + 1), now, stop);
      }
    }
  }

  private closeActiveShare(
    roomId: DailyRoomId,
    identityId: string,
    now: number,
    stop: boolean,
  ): void {
    const key = `${roomId}:${identityId}`;
    const active = this.activeShares.get(key);
    if (!active) return;
    let cursor = active.startedAt;
    while (cursor < now) {
      const date = getShanghaiDate(cursor);
      const nextDate = shiftShanghaiDate(date, 1);
      const segmentEnd = Math.min(now, Date.parse(`${nextDate}T00:00:00+08:00`));
      const durationMs = Math.max(0, segmentEnd - cursor);
      const report = this.getMutableReport(roomId, cursor);
      report.screenShareDurationMs = (report.screenShareDurationMs ?? 0) + durationMs;
      this.getParticipant(report, identityId, active.nickname, cursor).screenShareDurationMs +=
        durationMs;
      report.hadActivity = true;
      this.touch(report, segmentEnd);
      cursor = segmentEnd;
    }
    if (stop) this.activeShares.delete(key);
    else active.startedAt = now;
  }

  private closeActiveGame(
    roomId: DailyRoomId,
    identityId: string,
    now: number,
    stop: boolean,
  ): void {
    const key = `${roomId}:${identityId}`;
    const active = this.activeGames.get(key);
    if (!active) return;
    let cursor = active.startedAt;
    while (cursor < now) {
      const date = getShanghaiDate(cursor);
      const nextDate = shiftShanghaiDate(date, 1);
      const midnight = Date.parse(`${nextDate}T00:00:00+08:00`);
      const segmentEnd = Math.min(now, midnight);
      const report = this.getMutableReport(roomId, cursor);
      const existing = report.gameActivities.find(
        (activity) =>
          activity.nickname === active.nickname && activity.gameName === active.gameName,
      );
      const durationMs = Math.max(0, segmentEnd - cursor);
      if (existing) {
        existing.durationMs += durationMs;
        existing.nickname = active.nickname;
      } else {
        report.gameActivities.push({
          nickname: active.nickname,
          gameName: active.gameName,
          durationMs,
        });
      }
      this.getParticipant(report, identityId, active.nickname, cursor).gameDurationMs += durationMs;
      report.gameActivities.sort((left, right) => right.durationMs - left.durationMs);
      this.touch(report, segmentEnd);
      cursor = segmentEnd;
    }
    if (stop) this.activeGames.delete(key);
    else active.startedAt = now;
    this.queueWrite();
  }

  private getMutableReport(roomId: DailyRoomId, now: number): DailyRoomReport {
    const date = getShanghaiDate(now);
    const roomReports = (this.reports.rooms[roomId] ??= {});
    const report = (roomReports[date] ??= createEmptyReport(roomId, date));
    this.prune(roomId, date);
    return report;
  }

  private getParticipant(
    report: DailyRoomReport,
    identityId: string,
    nickname: string,
    now: number,
  ): DailyRoomParticipantSummary {
    const participants = (report.participants ??= []);
    let participant = participants.find((entry) => entry.identityId === identityId);
    if (!participant) {
      participant = {
        identityId: identityId.slice(0, 160),
        nickname: nickname.trim().slice(0, 32) || "朋友",
        presenceDurationMs: 0,
        joinSessions: 0,
        gameDurationMs: 0,
        messageCount: 0,
        screenShareCount: 0,
        screenShareDurationMs: 0,
        firstSeenAt: new Date(now).toISOString(),
      };
      participants.push(participant);
    } else {
      participant.nickname = nickname.trim().slice(0, 32) || participant.nickname;
    }
    return participant;
  }

  private touch(report: DailyRoomReport, now: number): void {
    report.schemaVersion = 1;
    report.revision = (report.revision ?? 0) + 1;
    report.updatedAt = new Date(now).toISOString();
    this.queueWrite();
  }

  private closeActiveTime(roomId: DailyRoomId, now: number, stop: boolean): void {
    const active = this.activeRooms.get(roomId);
    if (!active?.activeSince) return;
    let cursor = active.activeSince;
    while (cursor < now) {
      const date = getShanghaiDate(cursor);
      const nextDate = shiftShanghaiDate(date, 1);
      const midnight = Date.parse(`${nextDate}T00:00:00+08:00`);
      const segmentEnd = Math.min(now, midnight);
      const report = this.getMutableReport(roomId, cursor);
      report.activeDurationMs += Math.max(0, segmentEnd - cursor);
      report.hadActivity = true;
      report.peakConcurrent = Math.max(report.peakConcurrent, active.count);
      this.addParticipants(roomId, getShanghaiDate(cursor), active.participants);
      cursor = segmentEnd;
    }
    active.activeSince = stop ? undefined : now;
    this.queueWrite();
  }

  private addParticipants(
    roomId: DailyRoomId,
    date: string,
    participants: Map<string, string>,
  ): void {
    const roomParticipants = (this.reports.participants[roomId] ??= {});
    const dayParticipants = (roomParticipants[date] ??= {});
    for (const [identityId, nickname] of participants) dayParticipants[identityId] = nickname;
    const report = this.getMutableReport(roomId, Date.parse(`${date}T12:00:00+08:00`));
    report.participantNicknames = uniqueNicknames(Object.values(dayParticipants));
    report.participantCount = report.participantNicknames.length;
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
        this.reports = {
          version: 3,
          rooms: {},
          participants: {},
          gameParticipants: {},
        };
        for (const roomId of ["main", "side"] as const) {
          const source = parsed.rooms[roomId];
          if (!source || typeof source !== "object") continue;
          this.reports.rooms[roomId] = Object.fromEntries(
            Object.entries(source).map(([date, value]) => [
              date,
              sanitizeReport(value, roomId, date),
            ]),
          );
          const persistedParticipants = parsed.participants?.[roomId];
          if (persistedParticipants && typeof persistedParticipants === "object") {
            this.reports.participants[roomId] = structuredClone(persistedParticipants);
          } else {
            this.reports.participants[roomId] = Object.fromEntries(
              Object.entries(this.reports.rooms[roomId] ?? {}).map(([date, report]) => [
                date,
                Object.fromEntries(
                  report.participantNicknames.map((nickname, index) => [
                    `legacy:${index}:${nickname}`,
                    nickname,
                  ]),
                ),
              ]),
            );
          }
          const persistedGames = parsed.gameParticipants?.[roomId];
          if (persistedGames && typeof persistedGames === "object") {
            this.reports.gameParticipants[roomId] = structuredClone(persistedGames);
            for (const [date, games] of Object.entries(persistedGames)) {
              this.gamesByDay.set(
                `${roomId}:${date}`,
                new Map(
                  Object.entries(games).map(([name, identities]) => [name, new Set(identities)]),
                ),
              );
            }
          }
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
