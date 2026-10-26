import type { IncomingMessage, ServerResponse } from "node:http";
import type { AccountBackend } from "./account-service";
import { CloudAsrService, CLOUD_ASR_MAX_BYTES, CLOUD_ASR_MODEL } from "./cloud-asr-service";
import { CloudAiService } from "./cloud-ai-service";
import { randomUUID } from "node:crypto";

const MIME = new Set([
  "audio/wav",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/webm",
  "audio/opus",
  "audio/flac",
]);
const send = (res: ServerResponse, status: number, payload: unknown) => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
};

/** Stateless personal-audio requests: authenticate before reading audio; never persist it. */
export class CloudAsrHttpController {
  private pending = 0;
  private readonly users = new Set<string>();
  private readonly rates = new Map<string, { since: number; count: number }>();
  constructor(
    private readonly accounts: AccountBackend,
    private readonly secure: (request: IncomingMessage) => boolean,
    private readonly service = new CloudAsrService(),
    private readonly textService = new CloudAiService(),
  ) {}
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!["/api/ai/status", "/api/ai/transcriptions", "/api/ai/text"].includes(path)) return false;
    const text = path === "/api/ai/text";
    if (!this.secure(req)) {
      send(res, 426, { error: { code: "account_secure_transport_required" } });
      return true;
    }
    if (path === "/api/ai/status" && req.method === "GET") {
      send(res, 200, {
        transcriptionConfigured: this.service.isConfigured(),
        transcriptionModel: CLOUD_ASR_MODEL,
        textConfigured: this.textService.isConfigured(),
      });
      return true;
    }
    if (path === "/api/ai/status" || req.method !== "POST") {
      send(res, 405, { error: { code: "cloud_asr_method_not_allowed" } });
      return true;
    }
    if (!(text ? this.textService : this.service).isConfigured()) {
      send(res, 503, {
        error: { code: text ? "cloud_ai_not_configured" : "cloud_asr_not_configured" },
      });
      return true;
    }
    if (!this.consume(`ip:${req.socket.remoteAddress ?? "unknown"}`, 120)) {
      send(res, 429, { error: { code: "cloud_asr_busy" } });
      return true;
    }
    const header = req.headers.authorization ?? "";
    const token = /^Bearer ([^\s]{1,8192})$/i.exec(header)?.[1];
    let userId: string;
    try {
      if (!token || !this.accounts.configured) throw Error();
      userId = (await this.accounts.verifyAccessToken(token)).userId;
    } catch {
      send(res, 401, { error: { code: "account_session_expired" } });
      return true;
    }
    if (this.pending >= 2 || this.users.has(userId) || !this.consume(`user:${userId}`, 60)) {
      send(res, 429, { error: { code: "cloud_asr_busy" } });
      return true;
    }
    const mime = (req.headers["content-type"] ?? "").split(";", 1)[0]!.trim().toLowerCase();
    if (text ? mime !== "application/json" : !MIME.has(mime)) {
      send(res, 415, { error: { code: "cloud_asr_invalid_request" } });
      return true;
    }
    const maximum = text ? 256 * 1024 : CLOUD_ASR_MAX_BYTES;
    if (Number(req.headers["content-length"]) > maximum) {
      send(res, 413, { error: { code: "cloud_asr_file_size_limit" } });
      return true;
    }
    this.pending++;
    this.users.add(userId);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const timedOut = setTimeout(() => {
      controller.abort();
      req.destroy();
    }, 180_000);
    timedOut.unref();
    req.once("aborted", cancel);
    res.once("close", cancel);
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        controller.signal.throwIfAborted();
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > maximum) throw Error("cloud_asr_file_size_limit");
        chunks.push(bytes);
      }
      if (!text) {
        const duration = Number(req.headers["x-shanghao-duration-ms"]);
        if (!size || !Number.isFinite(duration) || duration <= 0 || duration > 300000)
          throw Error("cloud_asr_invalid_request");
        const result = await this.service.transcribe(
          Buffer.concat(chunks),
          mime,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        send(res, 200, result);
        return true;
      }
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw Error("cloud_asr_invalid_request");
      }
      if (text) {
        if (
          !payload ||
          Array.isArray(payload) ||
          Object.keys(payload).some((k) => k !== "prompt") ||
          typeof payload.prompt !== "string" ||
          !payload.prompt.trim() ||
          payload.prompt.length > 60_000
        )
          throw Error("cloud_asr_invalid_request");
        const content = await this.textService.execute(
          {
            type: "cloud_ai_request",
            roomId: "personal",
            peerId: userId,
            requestId: randomUUID(),
            purpose: "organize",
            prompt: payload.prompt,
            useWebSearch: false,
            responseFormat: "json",
          },
          controller.signal,
        );
        controller.signal.throwIfAborted();
        send(res, 200, { content });
        return true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const code =
        /^cloud_asr_(?:http_\d{3}|not_configured|invalid_request|file_size_limit|invalid_response|response_too_large)$/.test(
          message,
        ) ||
        /^cloud_ai_(?:not_configured|auth_failed|balance_insufficient|busy|provider_unavailable|invalid_response)$/.test(
          message,
        )
          ? message
          : controller.signal.aborted
            ? "cloud_asr_timeout"
            : "cloud_asr_network_error";
      send(
        res,
        code === "cloud_asr_invalid_request"
          ? 400
          : code === "cloud_asr_file_size_limit"
            ? 413
            : 502,
        { error: { code } },
      );
    } finally {
      clearTimeout(timedOut);
      req.off("aborted", cancel);
      res.off("close", cancel);
      this.pending--;
      this.users.delete(userId);
    }
    return true;
  }
  private consume(key: string, limit: number): boolean {
    const now = Date.now();
    for (const [name, row] of this.rates) if (now - row.since >= 60_000) this.rates.delete(name);
    let row = this.rates.get(key);
    if (!row) {
      if (this.rates.size >= 4096) return false;
      row = { since: now, count: 0 };
      this.rates.set(key, row);
    }
    return ++row.count <= limit;
  }
}
