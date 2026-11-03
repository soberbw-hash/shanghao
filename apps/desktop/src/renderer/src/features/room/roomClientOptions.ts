import type {
  BuiltInAvatarId,
  ChatMessage,
  ChatRecallEvent,
  DailyRoomReport,
  RoomMember,
  RoomQuickMessage,
  RoomCollectionItem,
  RoomConnectionState,
  SceneReaction,
  SignalingEventPayload,
} from "@private-voice/shared";
import type {
  ChronicleStateMessage,
  ReplayStateMessage,
  ChannelCountsMessage,
} from "@private-voice/signaling";
import type { PeerAudioStats } from "@private-voice/webrtc";
import type { QuickMessageControlEvent } from "../chat/quickReplies";
import type { RemoteScreenFrame } from "./roomClient";

export interface RoomClientOptions {
  onChronicleState?: (message: ChronicleStateMessage) => void;
  onReplayState?: (message: ReplayStateMessage) => void;
  signalingUrl: string;
  roomId: string;
  peerId: string;
  profileId?: string;
  nickname: string;
  avatarDataUrl?: string;
  avatarId?: BuiltInAvatarId;
  localStream: MediaStream;
  appVersion: string;
  protocolVersion: string;
  buildNumber: string;
  onMembers: (members: RoomMember[]) => void;
  onRoomName: (
    roomName: string,
    privateRoom?: import("@private-voice/shared").PrivateRoomInfo,
  ) => void;
  onConnectionState: (state: RoomConnectionState) => void;
  onRemoteStream: (peerId: string, stream: MediaStream | undefined) => void;
  onChatMessage: (message: ChatMessage) => void;
  onChatRecall: (event: ChatRecallEvent) => void;
  onChatHistory: (messages: ChatMessage[]) => void;
  onChannelCounts?: (counts: ChannelCountsMessage["counts"]) => void;
  onDailyRoomReports: (roomId: string, reports: DailyRoomReport[]) => void;
  onRoomCollection: (items: RoomCollectionItem[], replace: boolean) => void;
  onKnock: (message: ChatMessage) => void;
  onRemoteScreenFrame: (peerId: string, frame?: RemoteScreenFrame) => void;
  onRemoteScreenShareState: (peerId: string, isSharing: boolean) => void;
  onLocalScreenShareViewers?: (peerIds: string[]) => void;
  onSceneReaction: (reaction: SceneReaction) => void;
  onQuickMessage: (message: RoomQuickMessage) => void;
  onQuickMessageControl?: (control: QuickMessageControlEvent) => void;
  onDiagnosticEvent?: (payload: SignalingEventPayload) => void;
  onReconnectAttempt?: (attempt: number) => void;
  onReconnectExhausted?: (error: Error) => void;
  onUpdateRequired?: (requiredVersion: string, currentVersion: string) => void;
  onAvatarConflict?: (availableAvatarIds: BuiltInAvatarId[]) => void;
  onSnapshotRevision?: (revision: number) => void;
  onRtt?: (rttMs: number) => void;
  onPeerLatency?: (peerId: string, latencyMs?: number) => void;
  onPeerStats?: (stats: Record<string, PeerAudioStats>) => void;
}
