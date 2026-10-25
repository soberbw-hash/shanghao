import {
  APP_BUILD_NUMBER,
  APP_PROTOCOL_VERSION,
  type BuiltInAvatarId,
} from "@private-voice/shared";
import { getSupportedTurnTransports, getTurnUrls } from "./signaling-ice-config";

/** Public operational read-model. Never include room identities, chat, tickets or credentials. */
export function buildSignalingHealth(state: {
  roomName: string;
  packageVersion?: string;
  activeRooms: number;
  connectedPeers: number;
  phoneMicSessions: number;
  maxRoomMembers: number;
  occupiedAvatarIds: BuiltInAvatarId[];
  droppedRealtimeMessages: number;
  cloudAiConfigured: boolean;
  accountConfigured: boolean;
  guestAllowed: boolean;
}) {
  const now = Date.now();
  return {
    ok: true,
    name: "shanghao-signaling",
    roomName: state.roomName,
    protocolVersion: APP_PROTOCOL_VERSION,
    buildNumber: APP_BUILD_NUMBER,
    packageVersion: state.packageVersion ?? process.env.npm_package_version ?? "unknown",
    uptime: process.uptime(),
    activeRooms: state.activeRooms,
    connectedPeers: state.connectedPeers,
    phoneMicSessions: state.phoneMicSessions,
    maxRoomMembers: state.maxRoomMembers,
    currentOnlineCount: state.connectedPeers,
    occupiedAvatarIds: state.occupiedAvatarIds,
    droppedRealtimeMessages: state.droppedRealtimeMessages,
    turnConfigured:
      getTurnUrls().length > 0 &&
      Boolean(
        process.env.TURN_SHARED_SECRET?.trim() ||
        (process.env.TURN_USERNAME?.trim() && process.env.TURN_CREDENTIAL?.trim()),
      ),
    supportedTurnTransports: getSupportedTurnTransports(),
    cloudAiConfigured: state.cloudAiConfigured,
    accountConfigured: state.accountConfigured,
    guestAllowed: state.guestAllowed,
    now: new Date(now).toISOString(),
    serverTime: now,
  };
}
