import {
  QUICK_MESSAGE_PRESETS,
  findQuickMessagePresetByContent,
  type QuickMessagePreset,
} from "@private-voice/shared";

export const QUICK_REPLIES = QUICK_MESSAGE_PRESETS.map((preset) => preset.content) as [
  string,
  string,
  string,
  string,
  string,
];

export const QUICK_REPLY_COOLDOWN_MS = 3_000;

const quickReplySet = new Set<string>(QUICK_REPLIES);

const quickReplyCodes: Record<string, string> = {
  // Keep this wire code for older peers, but do not expose it as a local preset.
  "👌": "ok",
  上号: "join",
  开麦: "mic",
  等我: "wait",
  听得到吗: "hear",
};

const quickReplyByCode = new Map<string, string>(
  Object.entries(quickReplyCodes).map(([content, code]) => [code, content]),
);

const QUICK_REPLY_TARGET_PREFIX = "shanghao-quick:";
const QUICK_MESSAGE_TARGET_PREFIX = "shanghao-quick-message:";

export const encodeQuickReplyTarget = (content: string): string | undefined => {
  const code = quickReplyCodes[content as keyof typeof quickReplyCodes];
  return code ? `${QUICK_REPLY_TARGET_PREFIX}${code}` : undefined;
};

export const decodeQuickReplyTarget = (targetPeerId: string): string | undefined => {
  if (!targetPeerId.startsWith(QUICK_REPLY_TARGET_PREFIX)) return undefined;
  return quickReplyByCode.get(targetPeerId.slice(QUICK_REPLY_TARGET_PREFIX.length));
};

export const encodeQuickMessageTarget = (presetId: string): string =>
  `${QUICK_MESSAGE_TARGET_PREFIX}${presetId}`;

export const decodeQuickMessageTarget = (targetPeerId: string): QuickMessagePreset | undefined => {
  if (!targetPeerId.startsWith(QUICK_MESSAGE_TARGET_PREFIX)) return undefined;
  const presetId = targetPeerId.slice(QUICK_MESSAGE_TARGET_PREFIX.length);
  return QUICK_MESSAGE_PRESETS.find((preset) => preset.id === presetId);
};

export const presetForQuickReplyContent = (content: string): QuickMessagePreset | undefined =>
  findQuickMessagePresetByContent(content);

export const isQuickReplyContent = (content: string): boolean => quickReplySet.has(content.trim());
