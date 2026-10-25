import { privateRoomInvitationUrl, type SignalingEventPayload } from "@private-voice/shared";

export function buildChannelInviteText({
  channelId,
  channelCode,
  roomName,
  serverUrl,
}: {
  channelId: string;
  channelCode: string;
  roomName: string;
  serverUrl?: string;
}): string {
  const link = privateRoomInvitationUrl({ roomId: channelId, channelCode, roomName, serverUrl });
  const title = roomName.replace(/[\r\n]/g, " ");
  return `来「${title}」一起上号\n频道号：${channelCode}\n点击加入：${link}\n也可在上号中输入频道号加入。`;
}

/** Diagnostics contain bounded envelope metadata, never user message bodies. */
export function summarizeSignalingEvent(payload: SignalingEventPayload): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    bridgeEventType: payload.type,
    code: payload.code,
    reason: payload.reason,
    wasClean: payload.wasClean,
    message: payload.message,
  };
  if (payload.type !== "message" || !payload.data) return summary;
  summary.payloadBytes = new TextEncoder().encode(payload.data).byteLength;
  try {
    const message = JSON.parse(payload.data) as Record<string, unknown>;
    summary.messageType = message.type;
    summary.roomId = message.roomId;
    summary.peerId = message.peerId;
    summary.targetPeerId = message.targetPeerId;
    summary.revision = message.revision;
    summary.memberCount = Array.isArray(message.members) ? message.members.length : undefined;
    if (message.type === "error") {
      summary.serverErrorCode = message.code;
      summary.serverErrorMessage =
        typeof message.message === "string" ? message.message.slice(0, 240) : undefined;
    }
  } catch {
    summary.messageType = "invalid_json";
  }
  return summary;
}
