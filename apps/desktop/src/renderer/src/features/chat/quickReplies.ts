export const QUICK_REPLIES = ["👌", "上号", "开麦", "等我", "听得到吗"] as const;

export const QUICK_REPLY_COOLDOWN_MS = 3_000;

const quickReplySet = new Set<string>(QUICK_REPLIES);

const quickReplyCodes = {
  "👌": "ok",
  上号: "join",
  开麦: "mic",
  等我: "wait",
  听得到吗: "hear",
} as const satisfies Record<(typeof QUICK_REPLIES)[number], string>;

const quickReplyByCode = new Map<string, string>(
  Object.entries(quickReplyCodes).map(([content, code]) => [code, content]),
);

const QUICK_REPLY_TARGET_PREFIX = "shanghao-quick:";

export const encodeQuickReplyTarget = (content: string): string | undefined => {
  const code = quickReplyCodes[content as keyof typeof quickReplyCodes];
  return code ? `${QUICK_REPLY_TARGET_PREFIX}${code}` : undefined;
};

export const decodeQuickReplyTarget = (targetPeerId: string): string | undefined => {
  if (!targetPeerId.startsWith(QUICK_REPLY_TARGET_PREFIX)) return undefined;
  return quickReplyByCode.get(targetPeerId.slice(QUICK_REPLY_TARGET_PREFIX.length));
};

export const isQuickReplyContent = (content: string): boolean => quickReplySet.has(content.trim());
