import { desktopApi } from "../../utils/desktopApi";
import type { LlmChatRequest, LlmChatResponse } from "@private-voice/shared";

export interface LlmHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

const QUICK_REPLIES = ["👍", "上号", "开麦", "等我"];

/**
 * 调用 AI 助手。API key 由服务器代理，渲染进程不持有任何凭证。
 * history 由调用方维护并传入。
 */
export const chatWithLLM = async (
  userMessage: string,
  history: LlmHistoryEntry[] = [],
): Promise<string> => {
  const request: LlmChatRequest = { message: userMessage, history };
  const result: LlmChatResponse = await desktopApi.llm.chat(request);

  if (!result.ok) {
    return friendlyFallbackMessage(result.reason);
  }
  return result.reply ?? friendlyFallbackMessage("empty");
};

export const shouldCallLLM = (message: string): boolean => {
  const trimmed = message.trim();
  return !QUICK_REPLIES.includes(trimmed);
};

const friendlyFallbackMessage = (reason?: LlmChatResponse["reason"]): string => {
  if (reason === "not_configured") {
    return "助手暂时没接通，让房主配置一下再问我吧。";
  }
  return "网络开小差了，稍后再问我吧。";
};
