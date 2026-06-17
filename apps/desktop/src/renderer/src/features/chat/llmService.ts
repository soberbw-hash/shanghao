import { desktopApi } from "../../utils/desktopApi";
import type { LlmChatRequest, LlmChatResponse } from "@private-voice/shared";

export interface LlmHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

/**
 * 判断是否应该调用 AI 助手。
 * 只有以"问"字开头的消息才触发 AI。
 */
export const shouldCallLLM = (message: string): boolean => {
  const trimmed = message.trim();
  return /^问[：:\s]?/.test(trimmed);
};

/**
 * 提取用户真正的问题（去掉"问"前缀）。
 */
export const extractQuestion = (message: string): string => {
  const trimmed = message.trim();
  return trimmed.replace(/^问[：:\s]?/, "").trim();
};

/**
 * 调用 AI 助手。
 */
export const chatWithLLM = async (
  userMessage: string,
  history: LlmHistoryEntry[] = [],
): Promise<string> => {
  const question = extractQuestion(userMessage);
  if (!question) {
    return "你想问什么呀？";
  }

  const request: LlmChatRequest = { message: question, history };
  const result: LlmChatResponse = await desktopApi.llm.chat(request);

  if (!result.ok) {
    return friendlyFallbackMessage(result.reason);
  }
  return result.reply ?? friendlyFallbackMessage("empty");
};

const friendlyFallbackMessage = (reason?: LlmChatResponse["reason"]): string => {
  if (reason === "not_configured") {
    return "助手暂时没接通，让房主配置一下再问我吧。";
  }
  return "网络开小差了，稍后再问我吧。";
};
