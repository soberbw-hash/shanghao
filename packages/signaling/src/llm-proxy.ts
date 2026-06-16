// 服务器侧 AI 代理：MiMo key 只在这里，从环境变量读取，绝不外泄给客户端。
// 客户端通过 /llm/chat HTTP 端点调用，不带任何 key。

const LLM_API_URL =
  process.env.SHANGHAO_LLM_API_URL ?? "https://token-plan-cn.xiaomimimo.com/v1/chat/completions";
const LLM_MODEL = process.env.SHANGHAO_LLM_MODEL ?? "mimo-v2.5-pro";
const LLM_API_KEY = process.env.SHANGHAO_LLM_API_KEY ?? "";

const SYSTEM_PROMPT = "你是聊天频道里的助手，简洁回答问题。用中文，50字以内，不要废话。回答时参考最新信息。";
const MAX_HISTORY_TURNS = 10;
const MAX_MESSAGE_LENGTH = 500;

export interface LlmProxyRequest {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface LlmProxyResponse {
  ok: boolean;
  reply?: string;
  reason?: "not_configured" | "request_failed" | "empty" | "bad_request";
}

export const isLlmProxyRequest = (value: unknown): value is LlmProxyRequest => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<LlmProxyRequest>;
  return typeof candidate.message === "string" && Array.isArray(candidate.history);
};

export const isLlmConfigured = (): boolean => LLM_API_KEY.trim().length > 0;

export const proxyLlmChat = async (request: LlmProxyRequest): Promise<LlmProxyResponse> => {
  if (!isLlmConfigured()) {
    return { ok: false, reason: "not_configured" };
  }

  const trimmed = request.message.trim();
  if (!trimmed || trimmed.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, reason: "bad_request" };
  }

  const recentHistory = request.history
    .filter((entry) => entry && typeof entry.content === "string")
    .slice(-MAX_HISTORY_TURNS);
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...recentHistory,
    { role: "user" as const, content: trimmed },
  ];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const response = await fetch(LLM_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_API_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return { ok: false, reason: "request_failed" };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    };
    const message = data.choices?.[0]?.message;
    const reply = message?.content || message?.reasoning_content;

    if (!reply) {
      return { ok: false, reason: "empty" };
    }

    return { ok: true, reply };
  } catch {
    return { ok: false, reason: "request_failed" };
  }
};
