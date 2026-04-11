import {
  DEFAULT_ROOM_NAME,
  MAX_ROOM_MEMBERS,
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  RoomLifecycleState,
  type ConnectionHealth,
  type HostSessionInfo,
  type RoomMember,
  type RoomSummary,
} from "@private-voice/shared";
import { create } from "zustand";

interface LocalProfilePayload {
  nickname?: string;
  avatarPath?: string;
  avatarDataUrl?: string;
}

interface RoomStoreState {
  room: RoomSummary;
  hostSession?: HostSessionInfo;
  joinSignalUrl: string;
  localStream?: MediaStream;
  remoteStreams: Record<string, MediaStream>;
  connectionHealth: ConnectionHealth;
  setConnectionState: (state: RoomConnectionState) => void;
  setRoom: (room: Partial<RoomSummary>) => void;
  setMembers: (members: RoomMember[]) => void;
  setJoinSignalUrl: (url: string) => void;
  setHostSession: (session?: HostSessionInfo) => void;
  setLocalStream: (stream?: MediaStream) => void;
  setRemoteStream: (peerId: string, stream?: MediaStream) => void;
  setConnectionHealth: (health: Partial<ConnectionHealth>) => void;
  syncLocalProfile: (profile: LocalProfilePayload) => void;
  updateMemberVolume: (memberId: string, volume: number) => void;
  resetRoom: () => void;
}

const localMemberLabel = "\u6211";
const emptySlotLabel = "\u7a7a\u4f4d";

const createEmptySlot = (index: number): RoomMember => ({
  id: `empty-slot-${index}`,
  nickname: emptySlotLabel,
  isHost: false,
  isLocal: false,
  isEmptySlot: true,
  isMuted: false,
  presenceState: MemberPresenceState.Offline,
  speakingState: MemberSpeakingState.Silent,
  volume: 1,
  joinedAt: new Date(0).toISOString(),
  connectionQuality: "good",
});

const createLocalPreviewMember = (profile?: LocalProfilePayload): RoomMember => ({
  id: "local-preview",
  nickname: profile?.nickname?.trim() || localMemberLabel,
  avatarPath: profile?.avatarPath,
  avatarDataUrl: profile?.avatarDataUrl,
  isHost: true,
  isLocal: true,
  isMuted: false,
  presenceState: MemberPresenceState.Online,
  speakingState: MemberSpeakingState.Silent,
  volume: 1,
  joinedAt: new Date().toISOString(),
  connectionQuality: "excellent",
});

const sortMembers = (members: RoomMember[]): RoomMember[] =>
  [...members].sort((left, right) => {
    if (left.isLocal !== right.isLocal) {
      return left.isLocal ? -1 : 1;
    }

    if (left.isHost !== right.isHost) {
      return left.isHost ? -1 : 1;
    }

    return left.joinedAt.localeCompare(right.joinedAt);
  });

const normalizeMembers = (members: RoomMember[]): RoomMember[] => {
  const actualMembers = sortMembers(
    members
      .filter((member) => !member.isEmptySlot)
      .slice(0, MAX_ROOM_MEMBERS),
  );

  const paddedMembers = [...actualMembers];
  while (paddedMembers.length < MAX_ROOM_MEMBERS) {
    paddedMembers.push(createEmptySlot(paddedMembers.length));
  }

  return paddedMembers;
};

const countActualMembers = (members: RoomMember[]): number =>
  members.filter((member) => !member.isEmptySlot).length;

const initialRoomState = (): RoomSummary => {
  const members = normalizeMembers([createLocalPreviewMember()]);
  return {
    roomId: "private-room",
    roomName: DEFAULT_ROOM_NAME,
    memberCount: countActualMembers(members),
    members,
    connectionState: RoomConnectionState.Idle,
    lifecycleState: RoomLifecycleState.Closed,
  };
};

export const useRoomStore = create<RoomStoreState>((set) => ({
  room: initialRoomState(),
  hostSession: undefined,
  joinSignalUrl: "",
  localStream: undefined,
  remoteStreams: {},
  connectionHealth: {
    latencyMs: 0,
    jitterMs: 0,
    packetLossPercent: 0,
    reconnectAttempt: 0,
  },
  setConnectionState: (connectionState) =>
    set((state) => ({
      room: {
        ...state.room,
        connectionState,
      },
    })),
  setRoom: (roomPatch) =>
    set((state) => ({
      room: {
        ...state.room,
        ...roomPatch,
      },
    })),
  setMembers: (members) =>
    set((state) => {
      const normalizedMembers = normalizeMembers(members);
      return {
        room: {
          ...state.room,
          members: normalizedMembers,
          memberCount: countActualMembers(normalizedMembers),
        },
      };
    }),
  setJoinSignalUrl: (joinSignalUrl) => set({ joinSignalUrl }),
  setHostSession: (hostSession) => set({ hostSession }),
  setLocalStream: (localStream) => set({ localStream }),
  setRemoteStream: (peerId, stream) =>
    set((state) => {
      const nextRemoteStreams = { ...state.remoteStreams };
      if (stream) {
        nextRemoteStreams[peerId] = stream;
      } else {
        delete nextRemoteStreams[peerId];
      }
      return { remoteStreams: nextRemoteStreams };
    }),
  setConnectionHealth: (healthPatch) =>
    set((state) => ({
      connectionHealth: {
        ...state.connectionHealth,
        ...healthPatch,
      },
    })),
  syncLocalProfile: (profile) =>
    set((state) => {
      const members = state.room.members.filter((member) => !member.isEmptySlot);
      const localMemberIndex = members.findIndex((member) => member.isLocal);
      const existingLocalMember =
        localMemberIndex >= 0 ? members[localMemberIndex] : undefined;
      const baseMember: RoomMember =
        existingLocalMember ?? createLocalPreviewMember(profile);

      const nextLocalMember: RoomMember = {
        ...baseMember,
        nickname: profile.nickname?.trim() || baseMember.nickname || localMemberLabel,
        avatarPath: profile.avatarPath,
        avatarDataUrl: profile.avatarDataUrl,
      };

      if (localMemberIndex >= 0) {
        members.splice(localMemberIndex, 1, nextLocalMember);
      } else {
        members.unshift(nextLocalMember);
      }

      const normalizedMembers = normalizeMembers(members);

      return {
        room: {
          ...state.room,
          members: normalizedMembers,
          memberCount: countActualMembers(normalizedMembers),
        },
      };
    }),
  updateMemberVolume: (memberId, volume) =>
    set((state) => ({
      room: {
        ...state.room,
        members: state.room.members.map((member) =>
          member.id === memberId ? { ...member, volume } : member,
        ),
      },
    })),
  resetRoom: () =>
    set({
      room: initialRoomState(),
      hostSession: undefined,
      joinSignalUrl: "",
      localStream: undefined,
      remoteStreams: {},
      connectionHealth: {
        latencyMs: 0,
        jitterMs: 0,
        packetLossPercent: 0,
        reconnectAttempt: 0,
      },
    }),
}));
