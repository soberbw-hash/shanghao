import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readAiProviderResponse } from "./ai-provider-response";

export interface BuiltInAiStatus {
  transcriptionConfigured: boolean;
  textConfigured: boolean;
  available: boolean;
  errorCode?: string;
}
/** Uses the authenticated app account; no vendor key exists in the desktop request. */
export class BuiltInAiClient {
  private cache?: { origin: string; until: number; value: BuiltInAiStatus };
  constructor(
    private readonly relayUrl: () => string | undefined,
    private readonly accessToken: () => Promise<string | undefined>,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  private endpoint(pathname: string): URL {
    const url = new URL(this.relayUrl() ?? "");
    if (
      url.username ||
      url.password ||
      !(
        url.protocol === "wss:" ||
        (url.protocol === "ws:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      )
    )
      throw Error("account_secure_transport_required");
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    url.pathname = pathname;
    url.search = "";
    url.hash = "";
    return url;
  }
  async status(): Promise<BuiltInAiStatus> {
    const url = this.endpoint("/api/ai/status");
    if (this.cache?.origin === url.origin && this.cache.until > Date.now()) return this.cache.value;
    let value: BuiltInAiStatus;
    try {
      const response = await this.fetcher(url.toString(), {
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok)
        throw Error(
          response.status === 404 || response.status === 405
            ? "cloud_asr_backend_upgrade_required"
            : `cloud_asr_http_${response.status}`,
        );
      const body = JSON.parse(
        await readAiProviderResponse(response, 4096, "cloud_asr_invalid_response"),
      );
      if (
        !body ||
        typeof body.transcriptionConfigured !== "boolean" ||
        typeof body.textConfigured !== "boolean"
      )
        throw Error("cloud_asr_invalid_response");
      value = {
        available: true,
        transcriptionConfigured: body.transcriptionConfigured === true,
        textConfigured: body.textConfigured === true,
      };
    } catch (error) {
      value = {
        available: false,
        transcriptionConfigured: false,
        textConfigured: false,
        errorCode:
          error instanceof Error &&
          /^cloud_asr_(?:http_\d{3}|backend_upgrade_required|invalid_response)$/.test(error.message)
            ? error.message
            : "cloud_asr_network_error",
      };
    }
    this.cache = { origin: url.origin, until: Date.now() + 10000, value };
    return value;
  }
  async transcribe(
    filePath: string,
    durationMs: number,
    signal: AbortSignal,
  ): Promise<{ text: string; modelName: string }> {
    signal.throwIfAborted();
    const status = await this.status();
    signal.throwIfAborted();
    if (!status.transcriptionConfigured)
      throw Error(status.errorCode ?? "cloud_asr_not_configured");
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 300000)
      throw Error("cloud_asr_duration_limit");
    const meta = await stat(filePath);
    if (meta.size <= 0 || meta.size > 12 * 1024 * 1024) throw Error("cloud_asr_file_size_limit");
    const mime: Record<string, string> = {
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".m4a": "audio/mp4",
      ".aac": "audio/aac",
      ".ogg": "audio/ogg",
      ".webm": "audio/webm",
      ".opus": "audio/opus",
      ".flac": "audio/flac",
    };
    const mimeType = mime[path.extname(filePath).toLowerCase()];
    if (!mimeType) throw Error("cloud_asr_invalid_request");
    const audio = await readFile(filePath);
    signal.throwIfAborted();
    const body = await this.request("/api/ai/transcriptions", audio, signal, {
      "content-type": mimeType,
      "x-shanghao-duration-ms": String(durationMs),
    });
    if (typeof body.text !== "string" || typeof body.modelName !== "string")
      throw Error("cloud_asr_invalid_response");
    return { text: body.text, modelName: body.modelName };
  }
  async organize(prompt: string, signal?: AbortSignal): Promise<string> {
    const result = await this.request("/api/ai/text", { prompt }, signal);
    if (typeof result.content !== "string") throw Error("cloud_ai_invalid_response");
    return result.content;
  }
  private async request(
    pathname: string,
    body: unknown,
    signal?: AbortSignal,
    extraHeaders?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    signal?.throwIfAborted();
    const url = this.endpoint(pathname);
    const token = await this.accessToken();
    if (!token) throw Error("account_session_expired");
    if (url.origin !== this.endpoint(pathname).origin) throw Error("account_session_expired");
    const requestFailed = (error: unknown): never => {
      if (signal?.aborted) throw Error("ai_task_paused");
      throw Error(
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
          ? "cloud_asr_timeout"
          : "cloud_asr_network_error",
      );
    };
    const response = await this.fetcher(url.toString(), {
      method: "POST",
      redirect: "error",
      headers: {
        "content-type": "application/json",
        ...extraHeaders,
        authorization: `Bearer ${token}`,
      },
      body: body instanceof Uint8Array ? new Uint8Array(body).buffer : JSON.stringify(body),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(180000)]),
    }).catch(requestFailed);
    const raw = await readAiProviderResponse(
      response,
      768 * 1024,
      "cloud_asr_response_too_large",
    ).catch(requestFailed);
    let payload: Record<string, unknown>;
    if (response.status === 404 || response.status === 405)
      throw Error("cloud_asr_backend_upgrade_required");
    try {
      payload = JSON.parse(raw);
    } catch {
      throw Error(response.ok ? "cloud_asr_invalid_response" : `cloud_asr_http_${response.status}`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw Error(response.ok ? "cloud_asr_invalid_response" : `cloud_asr_http_${response.status}`);
    if (!response.ok) {
      const code = (payload.error as { code?: unknown } | undefined)?.code;
      if (code === "cloud_asr_busy") throw Error("cloud_asr_http_429");
      throw Error(
        typeof code === "string" && /^(cloud_asr_|cloud_ai_|account_)[a-z0-9_]{1,80}$/.test(code)
          ? code
          : `cloud_asr_http_${response.status}`,
      );
    }
    signal?.throwIfAborted();
    return payload;
  }
}
