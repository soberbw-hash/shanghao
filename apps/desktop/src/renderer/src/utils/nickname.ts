const BLOCKED_NICKNAME_TERMS = [
  "daddy",
  "father",
  "grandpa",
  "grandfather",
  "爸爸",
  "父亲",
  "父王",
  "爷爷",
  "祖父",
  "祖宗",
  "老子",
  "爹",
];

const normalizeNickname = (value: string): string =>
  value.toLocaleLowerCase("zh-CN").replace(/[\s._\-·~!！?？,，。'"“”‘’]/g, "");

export const getNicknameValidationError = (value: string): string | undefined => {
  const normalized = normalizeNickname(value.trim());
  if (!normalized) return "先填一个昵称。";
  if (BLOCKED_NICKNAME_TERMS.some((term) => normalized.includes(term))) {
    return "这个昵称容易冒犯朋友，换一个正常称呼吧。";
  }
  return undefined;
};
