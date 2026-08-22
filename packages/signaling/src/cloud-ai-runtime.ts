import type { DailyRoomReport } from "@private-voice/shared";
import type { WebSocket } from "ws";

import type { CloudAiResponseMessage, SignalEnvelope } from "./protocol";
import type { DailyRoomReportStore } from "./daily-room-report-store";
import { CloudAiRequestController } from "./cloud-ai-request-controller";
import { CloudAiService } from "./cloud-ai-service";
import { DailyRoomCommentaryService } from "./daily-room-commentary-service";

type Logger = (message: string, context?: Record<string, unknown>) => void;

/** Keeps optional cloud AI roles outside the realtime signaling orchestrator. */
export class CloudAiRuntime {
  private readonly requests: CloudAiRequestController;
  private readonly commentary: DailyRoomCommentaryService;

  constructor(reports: Promise<DailyRoomReportStore>, logger?: Logger) {
    const service = new CloudAiService();
    this.requests = new CloudAiRequestController(logger, service);
    this.commentary = new DailyRoomCommentaryService(reports, service, logger);
  }

  isConfigured(): boolean {
    return this.requests.isConfigured();
  }

  cancelSocket(socket: WebSocket): void {
    this.requests.cancelSocket(socket);
  }

  handleSignal(
    socket: WebSocket,
    message: SignalEnvelope,
    send: (message: CloudAiResponseMessage) => void,
  ): boolean {
    return this.requests.handleSignal(socket, message, send);
  }

  getDailyReports(roomId: DailyRoomReport["roomId"]): Promise<DailyRoomReport[]> {
    return this.commentary.getReports(roomId);
  }
}
