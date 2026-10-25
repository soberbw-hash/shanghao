import type { AiAsrModelId } from "@private-voice/shared";

/** Compact product labels; full technical identity remains available in the selector tooltip. */
export function asrModelLabel(id: AiAsrModelId, full: string): string {
  if (id === "qwen3-asr-0.6b-force") return "千问 0.6B · 时间对齐";
  if (id === "qwen3-asr-1.7b-force") return "千问 1.7B · 时间对齐";
  return full
    .replace(/\s*\+\s*ForcedAligner/g, " · 对齐")
    .replace(/\s*\+\s*FSMN-VAD\s*\+\s*CT-punc/g, "");
}
