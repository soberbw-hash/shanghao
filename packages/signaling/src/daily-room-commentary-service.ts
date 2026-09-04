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
    if (reports[0] && !this.hasRichCommentary(reports[0].commentary)) {
      // Despite the legacy "cloud_ai" protocol name, CloudAiService is the
      // user's DeepSeek-compatible API client. This never calls CloudBase AI
      // and therefore cannot consume CloudBase AI resource points.
      await this.ensure(reports[0]);
      reports = store.getHistory(roomId);
    }
    return reports;
  }

  async ensure(report: DailyRoomReport): Promise<void> {
    if (this.hasRichCommentary(report.commentary) || !this.cloudAi.isConfigured()) return;
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
        "根据下面的昨日房间统计，写一段有活人感的中文点评。",
        "必须分成2到3行，每行18到45个汉字，总长度80到150字；行与行之间使用换行。",
        "可以加入2到4个自然的emoji，允许轻微毒舌、吐槽和玩梗，但不要攻击任何人，不要编造统计里没有的事件。",
        '只返回JSON：{"commentary":"第一行\\n第二行"}。',
        JSON.stringify({
          room: report.roomId === "side" ? "二号房" : "一号房",
          participantNicknames: report.participantNicknames,
          participantCount: report.participantCount,
          activeMinutes: Math.round(report.activeDurationMs / 60_000),
          peakConcurrent: report.peakConcurrent,
          messageCount: report.messageCount,
          screenShareCount: report.screenShareCount,
          games: report.games,
          gameActivities: report.gameActivities,
          participants: report.participants,
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

  private hasRichCommentary(value: string | undefined): boolean {
    return Boolean(value && value.split(/\r?\n/).filter((line) => line.trim()).length >= 2);
  }
}
