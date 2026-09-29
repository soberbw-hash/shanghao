import type { RendererDiagnosticsSummary } from "@private-voice/shared";

import type { AiComputeEvent } from "./resource-scheduler";

const RETENTION_MS = 10 * 60_000;
const MAX_EVENTS = 512;
const PEER_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const ROOM_EVENTS = new Set([
  "join_requested",
  "microphone_acquire_started",
  "microphone_acquired",
  "connect_started",
  "connected",
  "join_failed",
  "leave_requested",
  "leave_completed",
  "disconnect_started",
  "disconnect_completed",
  "disconnect_superseded",
  "reconnect_attempt",
  "reconnect_exhausted",
  "device_switch_started",
  "device_switch_applied",
  "device_switch_discarded",
  "device_switch_failed",
]);
const AUDIO_EVENTS = new Set([
  "audio_worklet_started",
  "script_processor_fallback_started",
  "mic_started",
  "audio_path_switched",
  "relay_first_chunk_received",
  "relay_first_chunk_played",
  "audio_resync_completed",
  "relay_fallback_enabled",
  "webrtc_connected",
  "mic_stopped",
  "relay_voice_gate_opened",
  "relay_voice_gate_closed",
  "audio_resync_requested",
  "audio_queue_reset",
  "peer_audio_silent_timeout",
]);
const AI_EVENTS = new Set(["queued", "started", "stopping", "released", "cancelled", "denied"]);
const AI_KINDS = new Set<AiComputeEvent["kind"]>([
  "transcription",
  "summary",
  "chapters",
  "question",
  "highlights",
  "marker_titles",
]);
const SAFE_REASONS = new Set([
  "relay_no_audio_received",
  "relay_silent_timeout",
  "new_audio_stream_epoch",
  "audio_resync_ack",
  "ai_task_paused",
  "ai_compute_queue_full",
  "cancelled",
  "recording_priority",
  "realtime_pressure",
  "manual_only",
  "waiting_for_game_to_finish",
  "peer_recovery",
  "packet_loss",
  "latency",
  "renderer_memory_pressure",
  "screen_share_network_pressure",
  "voice_network_pressure",
  "memory_pressure",
]);

export interface RuntimeTimelineEntry {
  at: string;
  source: "room" | "audio" | "ai";
  event: string;
  generation?: number;
  peerId?: string;
  audioStreamEpoch?: number;
  fromPath?: "webrtc" | "relay";
  toPath?: "webrtc" | "relay";
  queueDurationMs?: number;
  droppedChunks?: number;
  jobId?: number;
  aiKind?: AiComputeEvent["kind"];
  manualRequest?: boolean;
  reason?: string;
}

const validTime = (value: unknown, now: number): number | undefined => {
  const at =
    typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(at) && at >= now - RETENTION_MS && at <= now + 60_000 ? at : undefined;
};

const safeReason = (value: unknown): string | undefined =>
  typeof value === "string" && SAFE_REASONS.has(value) ? value : undefined;

const safeCount = (value: unknown, maximum: number): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : undefined;

const safeDurationMs = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 60_000
    ? Math.round(value)
    : undefined;

const safeAudioPath = (value: unknown): "webrtc" | "relay" | undefined =>
  value === "webrtc" || value === "relay" ? value : undefined;

/** Joins existing bounded lifecycle signals for diagnostics without copying message content. */
export const buildRuntimeEventTimeline = (
  input: {
    room?: RendererDiagnosticsSummary["roomSessionTimeline"];
    audio?: RendererDiagnosticsSummary["audioTimeline"];
    ai: readonly AiComputeEvent[];
  },
  now = Date.now(),
): {
  capturedAt: string;
  retentionMs: number;
  capacity: number;
  omittedEvents: number;
  events: RuntimeTimelineEntry[];
} => {
  const entries: Array<RuntimeTimelineEntry & { atMs: number }> = [];
  let omittedEvents = 0;
  const add = (entry: RuntimeTimelineEntry, rawTime: unknown) => {
    const atMs = validTime(rawTime, now);
    const allowedEvents =
      entry.source === "room" ? ROOM_EVENTS : entry.source === "audio" ? AUDIO_EVENTS : AI_EVENTS;
    if (atMs === undefined || !allowedEvents.has(entry.event)) {
      omittedEvents += 1;
      return;
    }
    entries.push({ ...entry, at: new Date(atMs).toISOString(), atMs });
  };

  for (const item of input.room?.events ?? []) {
    add(
      {
        at: item.at,
        source: "room",
        event: item.event,
        generation:
          Number.isSafeInteger(item.generation) && item.generation >= 0
            ? item.generation
            : undefined,
      },
      item.at,
    );
  }
  for (const item of input.audio ?? []) {
    add(
      {
        at: "",
        source: "audio",
        event: typeof item.event === "string" ? item.event : "",
        peerId:
          typeof item.peerId === "string" && PEER_ID.test(item.peerId) ? item.peerId : undefined,
        audioStreamEpoch: safeCount(item.audioStreamEpoch, 1_000_000),
        fromPath: safeAudioPath(item.fromPath),
        toPath: safeAudioPath(item.toPath),
        queueDurationMs: safeDurationMs(item.queueDurationMs),
        droppedChunks: safeCount(item.droppedChunks, 1_000_000),
        reason: safeReason(item.reason),
      },
      item.time,
    );
  }
  for (const item of input.ai) {
    add(
      {
        at: "",
        source: "ai",
        event: item.phase,
        jobId: Number.isSafeInteger(item.id) && item.id >= 0 ? item.id : undefined,
        aiKind: AI_KINDS.has(item.kind) ? item.kind : undefined,
        manualRequest: typeof item.manualRequest === "boolean" ? item.manualRequest : undefined,
        reason: safeReason(item.reason),
      },
      item.at,
    );
  }

  entries.sort((left, right) => left.atMs - right.atMs);
  omittedEvents += Math.max(0, entries.length - MAX_EVENTS);
  return {
    capturedAt: new Date(now).toISOString(),
    retentionMs: RETENTION_MS,
    capacity: MAX_EVENTS,
    omittedEvents,
    events: entries.slice(-MAX_EVENTS).map(({ atMs: _atMs, ...entry }) => entry),
  };
};
