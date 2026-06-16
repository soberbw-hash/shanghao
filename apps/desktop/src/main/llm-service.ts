import type { LlmChatRequest, LlmChatResponse, RendererLogPayload } from "@private-voice/shared";

/**
 * AI 聊天助手 — 服务器代理模式。
 * 客户端不持有任何 API key，通过 relay 服务器的 /llm/chat HTTP 端点间接调用 MiMo。
 */

const LLM_PROXY_TIMEOUT_MS = 15_000;

export interface LlmServiceOptions {
  getRelayServerUrl: () => string | undefined;
  getChannelAccessCode: () => string | undefined;
  writeLog?: (payload: RendererLogPayload) => Promise<void>;
}

export class LlmService {
  constructor(private readonly options: LlmServiceOptions) {}

  async chat(request: LlmChatRequest): Promise<LlmChatResponse> {
    const baseUrl = this.options.getRelayServerUrl?.();
    if (!baseUrl) {
      await this.log("warn", "llm chat skipped: no relay server url configured");
      return { ok: false, reason: "not_configured" };
    }

    const httpUrl = wsToHttp(baseUrl);
    if (!httpUrl) {
      await this.log("warn", "llm chat skipped: cannot convert relay url to http", { baseUrl });
      return { ok: false, reason: "not_configured" };
    }

    const channelCode = this.options.getChannelAccessCode?.();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), LLM_PROXY_TIMEOUT_MS);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (channelCode) {
        headers["X-Channel-Code"] = channelCode;
      }

      const response = await fetch(`${httpUrl}/llm/chat`, {
        method: "POST",
        signal: controller.signal,
        headers,
        body: JSON.stringify({
          message: request.message,
          history: request.history,
        }),
      });

      clearTimeout(timeout);

      if (response.status === 403) {
        await this.log("warn", "llm chat rejected: channel code mismatch");
        return { ok: false, reason: "not_configured" };
      }

      if (!response.ok) {
        await this.log("warn", "llm proxy request failed", { status: response.status });
        return { ok: false, reason: "request_failed" };
      }

      const result = (await response.json()) as LlmChatResponse;
      return result;
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      await this.log("warn", "llm chat error", {
        error: error instanceof Error ? error.message : String(error),
        aborted,
      });
      return { ok: false, reason: "request_failed" };
    }
  }

  private async log(
    level: RendererLogPayload["level"],
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    await this.options.writeLog?.({ category: "app", level, message, context });
  }
}

function wsToHttp(wsUrl: string): string | null {
  try {
    const url = new URL(wsUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    } else {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
