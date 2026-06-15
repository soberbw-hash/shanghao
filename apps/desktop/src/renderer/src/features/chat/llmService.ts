const MIMO_API_URL = "https://api.xiaomi.com/v1/chat/completions";
const MIMO_MODEL = "MiMo-v2.5";
const MIMO_API_KEY = "tp-cu9avv6x15apzb3yrpr3f8dbj3kyqfka2edd6le64nsv8ap";

const SYSTEM_PROMPT = `你是"上号助手"，一个开黑语音频道里的游戏助手。你主要帮助玩家解决英雄联盟（LoL）等游戏问题。

你的职责：
- 回答出装推荐、符文搭配、对线技巧
- 解释英雄技能机制和连招
- 推荐阵容搭配
- 回答游戏机制问题
- 提供简短实用的建议

回复要求：
- 简洁明了，不要废话
- 用中文回复
- 每次回复控制在100字以内
- 如果问题和游戏无关，简单回答后引导回游戏话题
- 不要说"我是AI"之类的话，你就当自己是频道里的一个朋友`;

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
  if (trimmed.startsWith("@")) {
    return true;
  }
  const gameKeywords = [
    "出装", "符文", "天赋", "技能", "连招", "对线",
    "英雄", "装备", "阵容", "打法", "玩法", "攻略",
    "adc", "apc", "打野", "辅助", "上单", "中单",
    "lol", "LOL", "英雄联盟", "峡谷", "排位", "匹配",
    "团战", "龙", "峡谷先锋", "大龙", "小龙",
    "亚索", "劫", "盲僧", "锤石", "vn", "ez",
    "金克丝", "烬", "卡莎", "德莱文", "寒冰",
    "石头人", "盖伦", "剑姬", "瑞文", "刀妹",
    "发条", "辛德拉", "妖姬", "阿狸", "佐伊",
    "奥恩", "塞恩", "墨菲特", "诺手", "鳄鱼",
    "赵信", "皇子", "蔚", "李青", "千珏",
    "露露", "娜美", "风女", "索拉卡", "布隆",
  ];
  return gameKeywords.some(function (kw) {
    return trimmed.toLowerCase().includes(kw.toLowerCase());
  });
};
