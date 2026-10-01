import { readFile } from "node:fs/promises";
import path from "node:path";

import { isStoredRoomId, type DailyRoomReport } from "@private-voice/shared";
import { writePrivateFileAtomically } from "./atomic-private-file";

type RoomId = string;
type CachedReports = Record<RoomId, DailyRoomReport[]>;

const CACHE_VERSION = 1;
const MAX_REPORTS_PER_ROOM = 14;

interface DailyRoomReportCacheFile {
  version: typeof CACHE_VERSION;
  reports: CachedReports;
}

const emptyReports = (): CachedReports => ({ main: [], side: [] });

const isRoomId = isStoredRoomId;

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
    Object.keys(input)
      .filter(isRoomId)
      .map((roomId) => [
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
  private cache?: CachedReports;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataDirectory: string) {
    this.filePath = path.join(userDataDirectory, "daily-room-reports.json");
  }

  async read(): Promise<CachedReports> {
    await this.writeQueue.catch(() => undefined);
    if (!this.cache) await this.load();
    return structuredClone(this.cache ?? emptyReports());
  }

  async save(reports: CachedReports): Promise<void> {
    const nextReports = sanitizeReports(reports);
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        if (!this.cache) await this.load();
        const payload: DailyRoomReportCacheFile = {
          version: CACHE_VERSION,
          reports: { ...this.cache, ...nextReports },
        };
        await writePrivateFileAtomically(this.filePath, Buffer.from(JSON.stringify(payload)));
        this.cache = payload.reports;
      });
    return this.writeQueue;
  }

  private async load(): Promise<void> {
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, "utf8"),
      ) as Partial<DailyRoomReportCacheFile>;
      if (
        parsed.version !== CACHE_VERSION ||
        !parsed.reports ||
        typeof parsed.reports !== "object" ||
        !Object.keys(parsed.reports).every(
          (roomId) =>
            isRoomId(roomId) &&
            Array.isArray(parsed.reports?.[roomId]) &&
            parsed.reports[roomId].every(
              (report) => isDailyRoomReport(report) && report.roomId === roomId,
            ),
        )
      ) {
        throw new Error("daily_room_reports_unreadable");
      }
      this.cache = sanitizeReports(parsed.reports);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error("daily_room_reports_unreadable", { cause: error });
      }
      this.cache = emptyReports();
    }
  }
}
