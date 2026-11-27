import type { DailyRoomReport } from "@private-voice/shared";
import type { WebSocket } from "ws";

import type { CloudAiResponseMessage, SignalEnvelope } from "./protocol";
import type { DailyRoomReportStore } from "./daily-room-report-store";
import { CloudAiRequestController } from "./cloud-ai-request-controller";
import { CloudAiService } from "./cloud-ai-service";
import { CloudAsrHttpController } from "./cloud-asr-http-controller";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AccountBackend } from "./account-service";
import { DailyRoomCommentaryService } from "./daily-room-commentary-service";
import { CloudAiAdminStore } from "./cloud-ai-admin-store";
import { CloudAiAdminAccess } from "./cloud-ai-admin-access";
import { CloudAiAdminHttp } from "./cloud-ai-admin-http";
import { CloudAsrService } from "./cloud-asr-service";
import { convertChronicleWebm } from "./cloud-asr-convert";

type Logger = (message: string, context?: Record<string, unknown>) => void;

/** Keeps optional cloud AI roles outside the realtime signaling orchestrator. */
export class CloudAiRuntime {
  private http?: CloudAsrHttpController;
  private adminHttp?: CloudAiAdminHttp;
  private readonly configuration: Promise<CloudAiAdminStore>;
  private store?: CloudAiAdminStore;
  readonly textService: Pick<CloudAiService, "isConfigured" | "execute">;
  readonly speechService: Pick<CloudAsrService, "isConfigured" | "transcribe"> & {
    getModelName: () => string | undefined;
  };
  configureHttp(accounts: AccountBackend, secure: (request: IncomingMessage) => boolean): void {
    this.adminHttp = new CloudAiAdminHttp(new CloudAiAdminAccess(secure), this.configuration);
    this.http = new CloudAsrHttpController(accounts, secure, this.speechService, this.textService);
  }
  async handleHttp(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    if (await this.adminHttp?.handle(request, response)) return true;
    return this.http?.handle(request, response) ?? Promise.resolve(false);
  }
  private readonly requests: CloudAiRequestController;
  private readonly commentary: DailyRoomCommentaryService;

  constructor(
    reports: Promise<DailyRoomReportStore>,
    logger?: Logger,
    memoryContext?: (roomId: string) => Promise<string>,
    configurationFile?: string,
  ) {
    this.configuration = CloudAiAdminStore.open(configurationFile).then((store) => {
      this.store = store;
      return store;
    });
    void this.configuration.catch(() =>
      logger?.("Cloud AI configuration unavailable", { code: "cloud_ai_admin_storage_invalid" }),
    );
    let cachedRevision = -1;
    let cachedTextService: CloudAiService | undefined;
    const service: Pick<CloudAiService, "isConfigured" | "execute"> = {
      isConfigured: () => Boolean(this.store?.provider("text")),
      execute: async (request, signal) => {
        const store = await this.configuration;
        const provider = store.provider("text");
        if (!provider) throw Error("cloud_ai_not_configured");
        const revision = store.snapshot().revision;
        if (!cachedTextService || cachedRevision !== revision) {
          const fallback = store.fallbackTextProvider();
          cachedTextService = new CloudAiService({
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            model: provider.model,
            ...(fallback ? { fallback } : {}),
            memoryContext,
          });
          cachedRevision = revision;
        }
        return cachedTextService.execute(request, signal);
      },
    };
    this.textService = service;
    this.speechService = {
      isConfigured: () => Boolean(this.store?.provider("speech")),
      getModelName: () => this.store?.provider("speech")?.model,
      transcribe: async (audio, mime, signal) => {
        const store = await this.configuration;
        const provider = store.provider("speech");
        if (!provider) throw Error("cloud_asr_not_configured");
        const fallback = store.fallbackSpeechProvider();
        const call = async (p: typeof provider) => {
          const deepSeek = new URL(p.baseUrl).hostname === "api.deepseek.com";
          const converted =
            deepSeek && mime.split(";", 1)[0]?.trim().toLowerCase() === "audio/webm";
          const payload = converted ? await convertChronicleWebm(audio, signal) : audio;
          return new CloudAsrService(
            p.apiKey,
            fetch,
            deepSeek
              ? "https://api.deepseek.com/v1/tools/asr"
              : `${p.baseUrl}/audio/transcriptions`,
            p.model,
          ).transcribe(payload, converted ? "audio/ogg" : mime, signal);
        };
        try {
          return await call(provider);
        } catch (error) {
          if (
            signal.aborted ||
            !fallback ||
            !(error instanceof Error) ||
            !/^(cloud_asr_conversion_failed|cloud_asr_provider_format_unsupported|cloud_asr_http_(400|401|402|403|408|413|429|5\d\d)|cloud_asr_invalid_response|cloud_asr_response_too_large|fetch failed)$/.test(
              error.message,
            )
          )
            throw error;
          return call(fallback);
        }
      },
    };
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

  getDailyReports(
    roomId: DailyRoomReport["roomId"],
    onUpdated?: (reports: DailyRoomReport[]) => void,
  ): Promise<DailyRoomReport[]> {
    return this.commentary.getReports(roomId, onUpdated);
  }
}
