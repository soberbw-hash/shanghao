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
export const QUICK_MUSIC_COOLDOWN_MS = 250;

export const quickMessageCooldownMs = (preset?: QuickMessagePreset): number =>
  preset?.mediaType === "music" ? QUICK_MUSIC_COOLDOWN_MS : QUICK_REPLY_COOLDOWN_MS;

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
const QUICK_MESSAGE_CONTROL_PREFIX = "shanghao-quick-control:";
const QUICK_MESSAGE_ID_ENCODING_PREFIX = "b64-";

const encodeQuickMessageId = (value: string): string => {
  if ([...value].every((character) => character.charCodeAt(0) <= 0x7f)) return value;

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${QUICK_MESSAGE_ID_ENCODING_PREFIX}${btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "")}`;
};

const decodeQuickMessageId = (value: string): string => {
  if (!value.startsWith(QUICK_MESSAGE_ID_ENCODING_PREFIX)) return value;

  try {
    const encoded = value.slice(QUICK_MESSAGE_ID_ENCODING_PREFIX.length);
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return value;
  }
};

export type QuickMessageControl = "toggle";
export type QuickMessageControlEvent = {
  presetId: string;
  control: "toggle";
  peerId: string;
  createdAt: string;
};

export const encodeQuickMessageControlTarget = (
  presetId: string,
  control: QuickMessageControl = "toggle",
): string => `${QUICK_MESSAGE_CONTROL_PREFIX}${control}:${encodeQuickMessageId(presetId)}`;

export const decodeQuickMessageControlTarget = (
  targetPeerId: string,
): { presetId: string; control: QuickMessageControl } | undefined => {
  if (!targetPeerId.startsWith(QUICK_MESSAGE_CONTROL_PREFIX)) return undefined;
  const [control, ...presetIdParts] = targetPeerId
    .slice(QUICK_MESSAGE_CONTROL_PREFIX.length)
    .split(":");
  if (control !== "toggle" || presetIdParts.length === 0) return undefined;
  const presetId = decodeQuickMessageId(presetIdParts.join(":"));
  return presetId ? { presetId, control } : undefined;
};

export const encodeQuickReplyTarget = (content: string): string | undefined => {
  const code = quickReplyCodes[content as keyof typeof quickReplyCodes];
  return code ? `${QUICK_REPLY_TARGET_PREFIX}${code}` : undefined;
};

export const decodeQuickReplyTarget = (targetPeerId: string): string | undefined => {
  if (!targetPeerId.startsWith(QUICK_REPLY_TARGET_PREFIX)) return undefined;
  return quickReplyByCode.get(targetPeerId.slice(QUICK_REPLY_TARGET_PREFIX.length));
};

export const encodeQuickMessageTarget = (presetId: string): string =>
  `${QUICK_MESSAGE_TARGET_PREFIX}${encodeQuickMessageId(presetId)}`;

export const decodeQuickMessageTarget = (targetPeerId: string): QuickMessagePreset | undefined => {
  if (!targetPeerId.startsWith(QUICK_MESSAGE_TARGET_PREFIX)) return undefined;
  const presetId = decodeQuickMessageId(targetPeerId.slice(QUICK_MESSAGE_TARGET_PREFIX.length));
  return QUICK_MESSAGE_PRESETS.find((preset) => preset.id === presetId);
};

export const presetForQuickReplyContent = (content: string): QuickMessagePreset | undefined =>
  findQuickMessagePresetByContent(content);

export const isQuickReplyContent = (content: string): boolean => quickReplySet.has(content.trim());
