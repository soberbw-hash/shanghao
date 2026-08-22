import type { CloudAiRequestMessage } from "./protocol";

interface CloudAiServiceOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetcher?: typeof fetch;
}

const MAX_RESPONSE_BYTES = 768 * 1024;

const normalizeBaseUrl = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("cloud_ai_configuration_invalid");
  }
  return url.toString().replace(/\/+$/, "");
};

const readBoundedText = async (response: Response): Promise<string> => {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("cloud_ai_response_too_large");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("cloud_ai_response_too_large");
  }
  return text;
};

const providerErrorCode = (status: number): string => {
  if (status === 401 || status === 403) return "cloud_ai_auth_failed";
  if (status === 402) return "cloud_ai_balance_insufficient";
  if (status === 429) return "cloud_ai_busy";
  if (status >= 500) return "cloud_ai_provider_unavailable";
  return "cloud_ai_request_failed";
};

/** Server-only DeepSeek client. API credentials never enter signaling payloads. */
export class CloudAiService {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetcher: typeof fetch;

  constructor(options: CloudAiServiceOptions = {}) {
    this.apiKey = options.apiKey?.trim() ?? process.env.DEEPSEEK_API_KEY?.trim() ?? "";
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl?.trim() ||
        process.env.DEEPSEEK_API_BASE_URL?.trim() ||
        "https://api.deepseek.com",
    );
    this.model = options.model?.trim() || process.env.DEEPSEEK_MODEL?.trim() || "deepseek-v4-flash";
    this.fetcher = options.fetcher ?? fetch;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.model);
  }

  async execute(request: CloudAiRequestMessage, signal?: AbortSignal): Promise<string> {
    if (!this.isConfigured()) throw new Error("cloud_ai_not_configured");
    return request.useWebSearch
      ? this.executeWithWebSearch(request, signal)
      : this.executeOpenAiCompatible(request, signal);
  }

  private async executeOpenAiCompatible(
    request: CloudAiRequestMessage,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: "你是上号的中文 AI 助手。严格按用户要求返回 JSON，不要输出 Markdown。",
          },
          { role: "user", content: request.prompt },
        ],
        max_tokens: request.purpose === "organize" ? 1_400 : 900,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
        stream: false,
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
        : AbortSignal.timeout(60_000),
    });
    const body = await readBoundedText(response);
    if (!response.ok) throw new Error(providerErrorCode(response.status));
    try {
      const payload = JSON.parse(body) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) throw new Error();
      return content;
    } catch {
      throw new Error("cloud_ai_invalid_response");
    }
  }

  private async executeWithWebSearch(
    request: CloudAiRequestMessage,
    signal?: AbortSignal,
  ): Promise<string> {
    const response = await this.fetcher(`${this.baseUrl}/anthropic/v1/messages`, {
      method: "POST",
      redirect: "error",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1_100,
        system:
          "你是上号房间里的中文 AI 助手。优先结合用户给出的语音记忆；遇到时效性或外部知识问题时使用联网搜索。严格返回用户要求的 JSON，不要输出 Markdown。",
        messages: [{ role: "user", content: request.prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      }),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(75_000)])
        : AbortSignal.timeout(75_000),
    });
    const body = await readBoundedText(response);
    if (!response.ok) throw new Error(providerErrorCode(response.status));
    try {
      const payload = JSON.parse(body) as {
        content?: Array<{ type?: string; text?: unknown }>;
      };
      const content =
        payload.content
          ?.filter((block) => block.type === "text" && typeof block.text === "string")
          .map((block) => block.text as string)
          .join("\n")
          .trim() ?? "";
      if (!content) throw new Error();
      return content;
    } catch {
      throw new Error("cloud_ai_invalid_response");
    }
  }
}
