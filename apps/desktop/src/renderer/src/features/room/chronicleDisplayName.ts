import { isAllowedNickname } from "@private-voice/shared";

const key = (accountId: string) => `shanghao:chronicle-name:${accountId}`;

export function validChronicleDisplayName(value: string): boolean {
  return value === value.trim() && Array.from(value).length <= 16 && isAllowedNickname(value);
}

export function readChronicleDisplayName(accountId?: string): string | undefined {
  if (!accountId) return undefined;
  try {
    const value = window.localStorage.getItem(key(accountId));
    return value && validChronicleDisplayName(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function saveChronicleDisplayName(accountId: string, value: string): void {
  if (!accountId || (value && !validChronicleDisplayName(value))) throw Error("invalid_name");
  if (value) window.localStorage.setItem(key(accountId), value);
  else window.localStorage.removeItem(key(accountId));
}
