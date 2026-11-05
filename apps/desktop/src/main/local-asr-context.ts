import type { VoiceMemoryLocalAsrContext } from "@private-voice/shared";

const safeTerm = (value: unknown, limit: number): value is string =>
  typeof value === "string" &&
  value.trim() === value &&
  value.length > 0 &&
  value.length <= limit &&
  /^[\p{L}\p{N} .+_-]+$/u.test(value);

/** Reject control text and bound untrusted input before it reaches a local model prompt. */
export function isLocalAsrContext(value: unknown): value is VoiceMemoryLocalAsrContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  return (
    Object.keys(context).every((key) => key === "gameName" || key === "terms") &&
    (context.gameName === undefined || safeTerm(context.gameName, 40)) &&
    Array.isArray(context.terms) &&
    context.terms.length <= 16 &&
    context.terms.every((term) => safeTerm(term, 20)) &&
    (context.gameName !== undefined || context.terms.length > 0)
  );
}

/** Only the current request is used; no conversation or previous worker state is included. */
export function localAsrContextPrompt(context: VoiceMemoryLocalAsrContext | undefined): string {
  if (!isLocalAsrContext(context)) return "";
  return [
    context.gameName ? `游戏：${context.gameName}` : "",
    context.terms.length ? `相关词：${context.terms.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("；");
}

export function assertLocalAsrContext(value: unknown): void {
  if (value !== undefined && !isLocalAsrContext(value)) throw new Error("invalid_asr_context");
}
