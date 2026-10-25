import { readFile } from "node:fs/promises";
import { analyzePcm16Wav } from "./asr-benchmark-runtime";
import { parseVibeVoiceOutput } from "./asr-transcript-parser";
import { transcribeRemoteParts } from "./remote-transcription-parts";

/** An empty long reply is not proof of silence. Recheck audible 30-second windows once. */
export async function transcribeRemoteWithEmptyRecovery(
  file: string,
  durationMs: number,
  signal: AbortSignal,
  send: (file: string, durationMs: number) => Promise<{ text: string; modelName: string }>,
  onRecovery: (index: number, count: number) => Promise<void>,
) {
  const first = await send(file, durationMs);
  signal.throwIfAborted();
  if (first.text.trim()) return first;
  if (durationMs <= 30000) return { ...first, emptyRechecked: true };
  const parts = await transcribeRemoteParts(
    file,
    durationMs,
    signal,
    async (wav, duration) => {
      const activity = analyzePcm16Wav(await readFile(wav));
      signal.throwIfAborted();
      return activity.audible ? send(wav, duration) : { text: "", modelName: first.modelName };
    },
    onRecovery,
    undefined,
    undefined,
    30000,
  );
  const segments = parts.flatMap((part) =>
    parseVibeVoiceOutput(part.text, "remote-recheck", part.startMs, part.durationMs),
  );
  return {
    text: segments.length
      ? JSON.stringify(
          segments.map((segment) => ({
            Start: segment.startMs / 1000,
            End: segment.endMs / 1000,
            Speaker: 1,
            Content: segment.text,
          })),
        )
      : "",
    modelName: first.modelName,
    emptyRechecked: true,
  };
}
