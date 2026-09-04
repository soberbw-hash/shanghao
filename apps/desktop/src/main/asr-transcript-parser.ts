import {
  isChinesePreferredTranscriptText,
  isReliableTranscriptText,
  type VoiceMemoryTranscriptSegment,
} from "@private-voice/shared";

import { parseTranscriptTimestamp } from "./asr-benchmark-runtime";

export const parseVibeVoiceOutput = (
  output: string,
  recordingId: string,
  offsetMs: number,
  durationMs = 30_000,
): VoiceMemoryTranscriptSegment[] => {
  const isAcceptedTranscript = (text: string, segmentDurationMs: number): boolean =>
    isReliableTranscriptText(text, segmentDurationMs) && isChinesePreferredTranscriptText(text);
  let sanitizedOutput = "";
  for (let index = 0; index < output.length; index += 1) {
    if (output.charCodeAt(index) === 27 && output[index + 1] === "[") {
      index += 2;
      while (index < output.length && output.charCodeAt(index) < 64) index += 1;
      continue;
    }
    sanitizedOutput += output[index] ?? "";
  }
  sanitizedOutput = sanitizedOutput.replace(/^\uFEFF/, "");
  const jsonStart = sanitizedOutput.indexOf("[");
  const jsonEnd = sanitizedOutput.lastIndexOf("]");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const items = JSON.parse(sanitizedOutput.slice(jsonStart, jsonEnd + 1)) as Array<{
        Start?: string | number;
        End?: string | number;
        Speaker?: string | number;
        Content?: string;
      }>;
      if (Array.isArray(items)) {
        const parsed = items.flatMap((item, index): VoiceMemoryTranscriptSegment[] => {
          const text = typeof item.Content === "string" ? item.Content.trim() : "";
          const startMs = offsetMs + parseTranscriptTimestamp(String(item.Start ?? 0));
          const endMs = Math.max(
            startMs + 100,
            offsetMs + parseTranscriptTimestamp(String(item.End ?? durationMs / 1_000)),
          );
          if (!text || !isAcceptedTranscript(text, endMs - startMs)) return [];
          return [
            {
              id: `${recordingId}-${startMs}-${index}`,
              recordingId,
              startMs,
              endMs,
              text,
              speakerId: `Speaker ${item.Speaker ?? 1}`,
              confidence: "pending",
            },
          ];
        });
        if (parsed.length) return parsed;
      }
    } catch {
      // The BitNet text prompt can legitimately start with '[' without being JSON.
    }
  }
  // Local model output is parsed one line at a time, so the input is bounded.
  // eslint-disable-next-line security/detect-unsafe-regex
  const pattern = /^\[([^\]]+)\s+-\s+([^\]]+)\]\s+(?:Speaker\s+([^:]+):\s*)?(.+)$/gm;
  const segments: VoiceMemoryTranscriptSegment[] = [];
  let sawTimestampOutput = false;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sanitizedOutput))) {
    sawTimestampOutput = true;
    const text = match[4]?.trim();
    if (!text) continue;
    const speaker = match[3]?.trim() || "1";
    const startMs = offsetMs + parseTranscriptTimestamp(match[1] ?? "0");
    const endMs = Math.max(startMs + 100, offsetMs + parseTranscriptTimestamp(match[2] ?? "0"));
    if (!isAcceptedTranscript(text, endMs - startMs)) continue;
    segments.push({
      id: `${recordingId}-${startMs}-${segments.length}`,
      recordingId,
      startMs,
      endMs,
      text,
      speakerId: `Speaker ${speaker}`,
      confidence: "pending",
    });
  }
  const plain = sanitizedOutput
    .replace(/---END---/g, "")
    .replace(/^assistant\s*/i, "")
    .trim();
  if (!sawTimestampOutput && !segments.length && plain && isAcceptedTranscript(plain, durationMs)) {
    const sentences = plain
      .split(/(?<=[。！？!?])\s*|\n+/u)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    const parts = sentences.length ? sentences : [plain];
    const totalCharacters = Math.max(
      1,
      parts.reduce((sum, part) => sum + part.length, 0),
    );
    let elapsed = 0;
    for (const [index, text] of parts.entries()) {
      const startRatio = elapsed / totalCharacters;
      elapsed += text.length;
      const endRatio = elapsed / totalCharacters;
      const startMs = offsetMs + Math.round(durationMs * startRatio);
      const endMs = Math.max(startMs + 100, offsetMs + Math.round(durationMs * endRatio));
      segments.push({
        id: `${recordingId}-${startMs}-${index}`,
        recordingId,
        startMs,
        endMs,
        text,
        speakerId: "Speaker 1",
        confidence: "pending",
      });
    }
  }
  return segments;
};
