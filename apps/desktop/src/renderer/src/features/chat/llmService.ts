const MIMO_API_URL = "https://api.siliconflow.cn/v1/chat/completions";
const MIMO_MODEL = "Qwen/Qwen2.5-7B-Instruct";
const MIMO_API_KEY = "tp-cu9avv6x15apzb3yrpr3f8dbj3kyqfka2edd6le64nsv8ap";

const SYSTEM_PROMPT = `你是一个聊天频道里的AI助手，帮助大家回答各种问题。

回复要求：
- 简洁明了
- 用中文回复
- 每次回复控制在80字以内
- 不要说"我是AI"之类的话`;

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

const conversationHistory: LLMMessage[] = [
  { role: "system", content: SYSTEM_PROMPT },
];

export const chatWithLLM = async (userMessage: string): Promise<string> => {
  conversationHistory.push({ role: "user", content: userMessage });

  if (conversationHistory.length > 21) {
    conversationHistory.splice(1, 2);
  }

  try {
    const response = await fetch(MIMO_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + MIMO_API_KEY,
      },
      body: JSON.stringify({
        model: MIMO_MODEL,
        messages: conversationHistory,
        temperature: 0.7,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      throw new Error("API request failed: " + response.status);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content ?? "暂时无法回答，请稍后再试。";

    conversationHistory.push({ role: "assistant", content: reply });

    return reply;
  } catch (error) {
    console.error("LLM API error:", error);
    return "网络开小差了，稍后再问我吧。";
  }
};

export const shouldCallLLM = (message: string): boolean => {
  const trimmed = message.trim();
  const quickReplies = ["👍", "上号", "开麦", "等我"];
  if (quickReplies.includes(trimmed)) {
    return false;
  }
  return true;
};
