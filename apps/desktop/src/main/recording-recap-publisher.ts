import type { DailyRoomRecordingRecap, VoiceMemoryRecord } from "@private-voice/shared";

import type { AiVoiceMemoryService } from "./ai-voice-memory-service";
import type { SignalingClientBridge } from "./signaling-client";

interface PublishVoiceMemoryOrganizationOptions {
  recordingId: string;
  voiceMemory: AiVoiceMemoryService;
  signalingClient: SignalingClientBridge;
}

const recordingReportDate = (createdAt: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(createdAt));

export const publishVoiceMemoryOrganization = async ({
  recordingId,
  voiceMemory,
  signalingClient,
}: PublishVoiceMemoryOrganizationOptions): Promise<VoiceMemoryRecord> => {
  const record = await voiceMemory.get(recordingId);
  const result = record?.organization?.finalResult;
  if (!record || record.organization?.status !== "completed" || !result) {
    throw new Error("voice_memory_organization_required");
  }
  if (record.roomId !== "main" && record.roomId !== "side") {
    throw new Error("recording_recap_room_invalid");
  }

  const recap: Omit<DailyRoomRecordingRecap, "uploadedAt"> = {
    recordingId: record.recordingId,
    description: result.description,
    summary: result.summary.map((item) => item.text).slice(0, 8),
    highlights: result.highlights.slice(0, 8).map((item) => ({
      title: item.title,
      description: item.description,
      startMs: item.startMs,
      endMs: item.endMs,
    })),
    funnyMoments: result.funnyMoments.slice(0, 8).map((item) => ({
      title: item.title,
      description: item.description,
      startMs: item.startMs,
      endMs: item.endMs,
    })),
    participantNicknames: result.participants
      .map((participant) => participant.nickname?.trim())
      .filter((nickname): nickname is string => Boolean(nickname))
      .slice(0, 20),
    keywords: result.keywords.slice(0, 24),
  };
  const reportDate = recordingReportDate(record.createdAt);
  const published = await signalingClient.publishRecordingRecap({
    roomId: record.roomId,
    reportDate,
    recap,
  });
  return voiceMemory.markOrganizationPublished(recordingId, {
    status: "published",
    roomId: published.roomId,
    reportDate: published.reportDate,
    publishedAt: published.publishedAt,
    serverRevision: published.serverRevision,
  });
};
