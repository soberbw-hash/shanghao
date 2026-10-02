import type { VoiceMemoryProcessRequest, VoiceMemoryRecord } from "@private-voice/shared";

export const createEmptyVoiceMemoryRecord = (
  request: VoiceMemoryProcessRequest,
): VoiceMemoryRecord => ({
  schemaVersion: 1,
  recordingId: request.recordingId,
  filePath: request.filePath,
  roomId: request.roomId,
  roomName: request.roomName,
  createdAt: new Date().toISOString(),
  recordedAt: request.recordedAt,
  updatedAt: new Date().toISOString(),
  phase: "idle",
  progress: 0,
  speakers: [],
  transcript: [],
  summary: [],
  chapters: [],
  highlights: [],
  markerTitles: (request.markers ?? []).map((marker) => ({
    markerId: marker.id,
    offsetMs: marker.offsetMs,
    title: `标记 ${Math.round(marker.offsetMs / 1_000)} 秒`,
  })),
  timeline: (request.markers ?? []).map((marker) => ({
    id: marker.id,
    kind: "marker" as const,
    offsetMs: marker.offsetMs,
    title: `标记 ${Math.round(marker.offsetMs / 1_000)} 秒`,
  })),
});
