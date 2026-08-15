import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DailyRoomReport } from "@private-voice/shared";

type RoomId = "main" | "side";
type CachedReports = Record<RoomId, DailyRoomReport[]>;

const CACHE_VERSION = 1;
const MAX_REPORTS_PER_ROOM = 14;

interface DailyRoomReportCacheFile {
  version: typeof CACHE_VERSION;
  reports: CachedReports;
}

const emptyReports = (): CachedReports => ({ main: [], side: [] });

const isRoomId = (value: unknown): value is RoomId => value === "main" || value === "side";

const isDailyRoomReport = (value: unknown): value is DailyRoomReport => {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<DailyRoomReport>;
  return (
    isRoomId(report.roomId) &&
    typeof report.date === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(report.date) &&
    typeof report.hadActivity === "boolean" &&
    typeof report.participantCount === "number" &&
    Array.isArray(report.participantNicknames) &&
    typeof report.activeDurationMs === "number" &&
    typeof report.peakConcurrent === "number" &&
    typeof report.messageCount === "number" &&
    typeof report.screenShareCount === "number" &&
    Array.isArray(report.games) &&
    Array.isArray(report.gameActivities)
  );
};

const sanitizeReports = (value: unknown): CachedReports => {
  const input = value && typeof value === "object" ? (value as Partial<CachedReports>) : {};
  return Object.fromEntries(
    (["main", "side"] as const).map((roomId) => [
      roomId,
      (Array.isArray(input[roomId]) ? input[roomId] : [])
        .filter(isDailyRoomReport)
        .filter((report) => report.roomId === roomId)
        .sort((left, right) => right.date.localeCompare(left.date))
        .slice(0, MAX_REPORTS_PER_ROOM),
    ]),
  ) as CachedReports;
};

export class DailyRoomReportCache {
  private readonly filePath: string;
  private readonly temporaryFilePath: string;
  private cache?: CachedReports;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataDirectory: string) {
    this.filePath = path.join(userDataDirectory, "daily-room-reports.json");
    this.temporaryFilePath = path.join(userDataDirectory, "daily-room-reports.tmp.json");
  }

  async read(): Promise<CachedReports> {
    await this.writeQueue.catch(() => undefined);
    if (!this.cache) await this.load();
    return {
      main: [...(this.cache?.main ?? [])],
      side: [...(this.cache?.side ?? [])],
    };
  }

  async save(reports: CachedReports): Promise<void> {
    const nextReports = sanitizeReports(reports);
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        this.cache = nextReports;
        const payload: DailyRoomReportCacheFile = {
          version: CACHE_VERSION,
          reports: nextReports,
        };
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(this.temporaryFilePath, JSON.stringify(payload), "utf8");
        await rename(this.temporaryFilePath, this.filePath);
      });
    return this.writeQueue;
  }

  private async load(): Promise<void> {
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as Partial<DailyRoomReportCacheFile>;
      this.cache =
        parsed.version === CACHE_VERSION ? sanitizeReports(parsed.reports) : emptyReports();
    } catch {
      this.cache = emptyReports();
    }
  }
}
