import { randomUUID } from "node:crypto";

import type { DailyRoomReport } from "@private-voice/shared";

import type { CloudAiRequestMessage } from "./protocol";
import type { DailyRoomReportStore } from "./daily-room-report-store";
import type { CloudAiService } from "./cloud-ai-service";

type Logger = (message: string, context?: Record<string, unknown>) => void;

export class DailyRoomCommentaryService {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly reports: Promise<DailyRoomReportStore>,
    private readonly cloudAi: CloudAiService,
    private readonly logger?: Logger,
  ) {}

  async getReports(roomId: DailyRoomReport["roomId"]): Promise<DailyRoomReport[]> {
    const store = await this.reports;
    let reports = store.getHistory(roomId);
    if (reports[0] && !reports[0].commentary) {
      await this.ensure(reports[0]);
      reports = store.getHistory(roomId);
    }
    return reports;
  }

  async ensure(report: DailyRoomReport): Promise<void> {
    if (report.commentary?.trim() || !this.cloudAi.isConfigured()) return;
    const key = `${report.roomId}:${report.date}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      await existing;
      return;
    }
    const task = this.generate(report).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    await task;
  }

  private async generate(report: DailyRoomReport): Promise<void> {
    const request: CloudAiRequestMessage = {
      type: "cloud_ai_request",
      roomId: report.roomId,
      peerId: "daily-room-report",
      requestId: randomUUID(),
      purpose: "organize",
      responseFormat: "json",
      useWebSearch: false,
      prompt: [
        "根据下面的昨日房间统计，写一句有活人感的中文点评。",
        "允许轻微调侃、吐槽或俏皮，但不要攻击任何人，不要编造统计里没有的事件。",
        '控制在35到70个汉字，可以带一个emoji。只返回JSON：{"commentary":"..."}。',
        JSON.stringify({
          room: report.roomId === "side" ? "二号房" : "一号房",
          participantNicknames: report.participantNicknames,
          participantCount: report.participantCount,
          activeMinutes: Math.round(report.activeDurationMs / 60_000),
          peakConcurrent: report.peakConcurrent,
          messageCount: report.messageCount,
          screenShareCount: report.screenShareCount,
          games: report.games.map((game) => game.name),
          workActivities: (report.workActivities ?? []).map((activity) => ({
            nickname: activity.nickname,
            workName: activity.workName,
            durationMinutes: Math.round(activity.durationMs / 60_000),
          })),
        }),
      ].join("\n"),
    };
    try {
      const content = await this.cloudAi.execute(request, AbortSignal.timeout(8_000));
      const parsed = JSON.parse(content) as { commentary?: unknown };
      if (typeof parsed.commentary !== "string") return;
      (await this.reports).setCommentary(report.roomId, report.date, parsed.commentary);
    } catch (error) {
      this.logger?.("daily room commentary generation failed", {
        roomId: report.roomId,
        date: report.date,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
