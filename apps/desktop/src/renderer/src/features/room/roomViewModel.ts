import type { ChatMessage, RoomMember, RoomQuickMessage } from "@private-voice/shared";

import type { ScreenShareItem } from "../screen-share/types";
import type { ScreenShareQuality } from "../screen-share/types";
import type { RemoteScreenFrame } from "../../store/roomStore";

const CHARACTER_BUBBLE_LIFETIME_MS = 4_200;
const STALE_SCREEN_FRAME_MS = 6_000;

export interface CharacterChatBubble {
  id: string;
  peerId: string;
  content: string;
  createdAt: string;
}

export const selectCharacterChatBubbles = (
  chatMessages: ChatMessage[],
  quickMessages: RoomQuickMessage[],
  now = Date.now(),
): CharacterChatBubble[] => {
  const latestByPeerId = new Map<string, CharacterChatBubble>();
  const messages = [
    ...chatMessages
      .filter(
        (message) =>
          message.kind !== "system" &&
          message.deliveryState !== "failed" &&
          Boolean(message.content.trim()),
      )
      .map((message) => ({
        id: message.clientMessageId ?? message.id,
        peerId: message.peerId,
        content: message.content.trim(),
        createdAt: message.createdAt,
      })),
    ...quickMessages.map((message) => ({
      id: message.id,
      peerId: message.peerId,
      content: message.content,
      createdAt: message.createdAt,
    })),
  ].sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  for (const message of messages) {
    if (
      latestByPeerId.has(message.peerId) ||
      now - Date.parse(message.createdAt) > CHARACTER_BUBBLE_LIFETIME_MS
    ) {
      continue;
    }
    latestByPeerId.set(message.peerId, message);
  }
  return [...latestByPeerId.values()];
};

interface ScreenShareViewInput {
  members: RoomMember[];
  localStream?: MediaStream;
  localQuality?: ScreenShareQuality;
  remoteStreams: Record<string, MediaStream>;
  remoteFrames: Record<string, RemoteScreenFrame>;
  remoteSharing: Record<string, true>;
  now: number;
}

const hasLiveVideo = (stream?: MediaStream): boolean =>
  Boolean(stream?.getVideoTracks().some((track) => track.readyState === "live" && !track.muted));

const isFreshFrame = (receivedAt: string, now: number): boolean => {
  const timestamp = Date.parse(receivedAt);
  return Number.isFinite(timestamp) && now - timestamp <= STALE_SCREEN_FRAME_MS;
};

export const selectScreenShareView = ({
  members,
  localStream,
  localQuality,
  remoteStreams,
  remoteFrames,
  remoteSharing,
  now,
}: ScreenShareViewInput): { items: ScreenShareItem[]; peerIds: string[] } => {
  const localMember = members.find((member) => member.isLocal);
  const items: ScreenShareItem[] = localStream
    ? [
        {
          id: "local",
          title: "你正在分享",
          stream: localStream,
          isLocal: true,
          quality: localQuality,
          transport: "webrtc",
        },
      ]
    : [];

  for (const [peerId, stream] of Object.entries(remoteStreams)) {
    if (!remoteSharing[peerId] || !hasLiveVideo(stream)) continue;
    const member = members.find((candidate) => candidate.id === peerId);
    items.push({
      id: peerId,
      title: `${member?.nickname ?? "好友"} 正在分享`,
      stream,
      transport: "webrtc",
    });
  }

  for (const [peerId, frame] of Object.entries(remoteFrames)) {
    if (
      !remoteSharing[peerId] ||
      !frame.data ||
      !isFreshFrame(frame.receivedAt, now) ||
      hasLiveVideo(remoteStreams[peerId])
    ) {
      continue;
    }
    const member = members.find((candidate) => candidate.id === peerId);
    items.push({
      id: `${peerId}-relay`,
      title: `${member?.nickname ?? "好友"} 正在分享`,
      frameDataUrl: frame.data,
      frameWidth: frame.width,
      frameHeight: frame.height,
      transport: "relay",
    });
  }

  const peerIds = [
    ...(localStream && localMember ? [localMember.id] : []),
    ...Object.keys(remoteSharing).filter(
      (peerId) =>
        hasLiveVideo(remoteStreams[peerId]) ||
        Boolean(remoteFrames[peerId]?.data && isFreshFrame(remoteFrames[peerId].receivedAt, now)),
    ),
  ].filter((peerId, index, peers) => peers.indexOf(peerId) === index);

  return { items, peerIds };
};
