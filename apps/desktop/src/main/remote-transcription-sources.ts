import { createHash } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { VoiceMemoryRecord } from "@private-voice/shared";
import { loadRecordingParticipantTracks } from "./recording-participant-tracks";
import { remoteTranscriptionRanges, transcribeRemoteParts } from "./remote-transcription-parts";
import { isTransientRemoteTranscriptionError } from "./remote-transcription-retry";

type RemoteState = NonNullable<VoiceMemoryRecord["remoteTranscription"]>;
export type RemoteSource = NonNullable<RemoteState["sources"]>[number] & { filePath: string };
export type RemoteSourcePart = RemoteState["parts"][number];

/** The recording catalog and local sidecar determine identity, never provider speaker guesses. */
export async function loadRemoteTranscriptionSources(
  record: VoiceMemoryRecord,
  durationMs: number,
  signal: AbortSignal,
): Promise<RemoteSource[] | undefined> {
  const tracks = await loadRecordingParticipantTracks(record.recordingId, record.filePath, true);
  signal.throwIfAborted();
  if (!tracks?.length) return undefined;
  const sources: RemoteSource[] = [];
  for (const track of tracks) {
    signal.throwIfAborted();
    if (!record.roomId || track.roomId !== record.roomId)
      throw new Error("participant_track_room_mismatch");
    if (
      !track.userId?.trim() ||
      !track.displayNameSnapshot?.trim() ||
      !Number.isFinite(track.startMs) ||
      !Number.isFinite(track.endMs) ||
      track.startMs < 0 ||
      track.endMs <= track.startMs
    )
      throw new Error("participant_track_manifest_invalid");
    const metadata = await lstat(track.filePath);
    const actualPath = await realpath(track.filePath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      path.resolve(actualPath).toLowerCase() !== path.resolve(track.filePath).toLowerCase()
    )
      throw new Error("participant_track_path_invalid");
    const length = Math.min(durationMs, track.endMs) - track.startMs;
    if (length <= 0) continue;
    const id = createHash("sha256")
      .update(
        JSON.stringify([
          record.recordingId,
          record.roomId,
          track.filePath,
          track.userId,
          track.startMs,
          length,
          metadata.size,
          metadata.mtimeMs,
        ]),
      )
      .digest("hex");
    sources.push({
      id,
      filePath: track.filePath,
      startMs: track.startMs,
      durationMs: length,
      speakerId: track.userId,
      displayNameSnapshot: track.displayNameSnapshot,
    });
  }
  if (!sources.length) throw new Error("participant_track_manifest_invalid");
  return sources.sort(
    (left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id),
  );
}

/** Sequential uploads preserve bounded bandwidth, per-track cache keys and original offsets. */
export async function transcribeRemoteSources(
  filePath: string,
  durationMs: number,
  sources: RemoteSource[] | undefined,
  signal: AbortSignal,
  send: Parameters<typeof transcribeRemoteParts>[3],
  onPart: (index: number, count: number) => Promise<void>,
  onCompleted: (part: RemoteSourcePart, index: number, count: number) => Promise<void>,
  cached: (startMs: number, durationMs: number, sourceId?: string) => RemoteSourcePart | undefined,
  options: { partMs?: 30000 | 300000; forcePcm?: boolean } = {},
) {
  const inputs = sources ?? [{ filePath, startMs: 0, durationMs, id: undefined }];
  const jobs = inputs
    .flatMap((source) =>
      remoteTranscriptionRanges(source.durationMs, options.partMs).map((range) => ({
        source,
        range,
      })),
    )
    .sort(
      (left, right) =>
        left.source.startMs + left.range.startMs - right.source.startMs - right.range.startMs ||
        (left.source.id ?? "").localeCompare(right.source.id ?? ""),
    );
  const count = jobs.length;
  const results: RemoteSourcePart[] = [];
  let completed = 0,
    consecutiveFailures = 0;
  let failed: unknown;
  for (const [jobIndex, { source, range }] of jobs.entries()) {
    signal.throwIfAborted();
    try {
      const startMs = source.startMs + range.startMs;
      const parts = await transcribeRemoteParts(
        source.filePath,
        range.durationMs,
        signal,
        send,
        () => onPart(completed + 1, count),
        (part) =>
          onCompleted(
            {
              ...part,
              startMs,
              ...(source.id ? { sourceId: source.id } : {}),
            },
            jobIndex + 1,
            count,
          ),
        (_offset, length) => {
          const saved = cached(startMs, length, source.id);
          return saved ? { ...saved, startMs: 0 } : undefined;
        },
        options.partMs,
        Boolean(source.id) || options.forcePcm,
        range.startMs,
      );
      results.push(
        ...parts.map((part) => ({
          ...part,
          startMs,
          ...(source.id ? { sourceId: source.id } : {}),
        })),
      );
      completed += parts.length;
      consecutiveFailures = 0;
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof Error) || !isTransientRemoteTranscriptionError(error.message))
        throw error;
      failed ??= error;
      if (++consecutiveFailures >= 3) throw error;
    }
  }
  if (failed) throw failed;
  return results;
}
