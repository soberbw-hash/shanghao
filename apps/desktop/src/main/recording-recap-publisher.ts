import {
  isStoredRoomId,
  type DailyRoomRecordingRecap,
  type VoiceMemoryRecord,
} from "@private-voice/shared";

import type { AiVoiceMemoryService } from "./ai-voice-memory-service";
import type { SignalingClientBridge } from "./signaling-client";

interface PublishVoiceMemoryOrganizationOptions {
  recordingId: string;
  voiceMemory: Pick<AiVoiceMemoryService, "get" | "markOrganizationPublished">;
  signalingClient: Pick<SignalingClientBridge, "publishRecordingRecap">;
  automatic?: boolean;
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
  automatic,
}: PublishVoiceMemoryOrganizationOptions): Promise<VoiceMemoryRecord> => {
  const record = await voiceMemory.get(recordingId);
  const result = record?.organization?.finalResult;
  if (
    !record ||
    record.phase !== "ready" ||
    record.organization?.status !== "completed" ||
    !result
  ) {
    throw new Error("voice_memory_organization_required");
  }
  if (!isStoredRoomId(record.roomId)) {
    throw new Error("recording_recap_room_invalid");
  }
  if (record.organizationPublication?.status === "published") return record;

  const recap: Omit<DailyRoomRecordingRecap, "uploadedAt"> = {
    recordingId: record.recordingId,
    description: (result.description || result.summary[0]?.text || "录音整理摘要").slice(0, 800),
    summary: result.summary
      .map((item) => item.text.trim().slice(0, 300))
      .filter(Boolean)
      .slice(0, 8),
    highlights: result.highlights.slice(0, 8).map((item) => ({
      title: (item.title || "精彩片段").slice(0, 80),
      description: (item.description || item.title || "精彩片段").slice(0, 320),
      startMs: item.startMs,
      endMs: item.endMs,
    })),
    funnyMoments: result.funnyMoments.slice(0, 8).map((item) => ({
      title: (item.title || "有趣片段").slice(0, 80),
      description: (item.description || item.title || "有趣片段").slice(0, 320),
      startMs: item.startMs,
      endMs: item.endMs,
    })),
    participantNicknames: result.participants
      .map((participant) => participant.nickname?.trim().slice(0, 32))
      .filter((nickname): nickname is string => Boolean(nickname))
      .slice(0, 20),
    keywords: result.keywords
      .map((keyword) => keyword.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 24),
  };
  const reportDate = recordingReportDate(record.recordedAt ?? record.createdAt);
  try {
    const published = await signalingClient.publishRecordingRecap({
      roomId: record.roomId,
      reportDate,
      recap,
    });
    if (published.roomId !== record.roomId || published.reportDate !== reportDate)
      throw new Error("recording_recap_response_mismatch");
    return await voiceMemory.markOrganizationPublished(
      recordingId,
      {
        status: "published",
        roomId: published.roomId,
        reportDate: published.reportDate,
        publishedAt: published.publishedAt,
        serverRevision: published.serverRevision,
      },
      record.organizedAt,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "recording_recap_publish_failed";
    await voiceMemory
      .markOrganizationPublished(
        recordingId,
        {
          status: "failed",
          roomId: record.roomId,
          reportDate,
          publishedAt: new Date().toISOString(),
          errorCode:
            code === "invalid_report_date"
              ? "recording_recap_date_unavailable"
              : code.startsWith("recording_recap_")
                ? code
                : "recording_recap_publish_failed",
        },
        record.organizedAt,
      )
      .catch(() => undefined);
    if (!automatic) throw error;
    return (await voiceMemory.get(recordingId)) ?? record;
  }
};
