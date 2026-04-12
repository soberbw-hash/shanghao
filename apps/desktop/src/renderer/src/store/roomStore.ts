import { create } from "zustand";

import {
  DEFAULT_ROOM_NAME,
  HostSessionState,
  MAX_ROOM_MEMBERS,
  MemberJoinState,
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  RoomLifecycleState,
  type ChatMessage,
  type ConnectionHealth,
  type ConnectionMode,
  type HostEvent,
  type HostSessionInfo,
  type RoomMember,
  type RoomSummary,
} from "@private-voice/shared";

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
  chatMessages: ChatMessage[];
  setConnectionState: (state: RoomConnectionState, reason?: string) => void;
  setLifecycleState: (state: RoomLifecycleState) => void;
  setRoom: (room: Partial<RoomSummary>) => void;
  setMembers: (members: RoomMember[]) => void;
  setJoinSignalUrl: (url: string) => void;
  setHostSession: (session?: HostSessionInfo) => void;
  setConnectionMode: (mode: ConnectionMode) => void;
  setLocalStream: (stream?: MediaStream) => void;
  setRemoteStream: (peerId: string, stream?: MediaStream) => void;
  setConnectionHealth: (health: Partial<ConnectionHealth>) => void;
  addChatMessage: (message: ChatMessage) => void;
  clearChatMessages: () => void;
  syncLocalProfile: (profile: LocalProfilePayload) => void;
  updateMemberVolume: (memberId: string, volume: number) => void;
  pushHostEvent: (event: Omit<HostEvent, "id" | "createdAt">) => void;
  clearHostEvents: () => void;
  resetRoom: () => void;
}

const localMemberLabel = "我";
const emptySlotLabel = "空位";

const createEmptySlot = (index: number): RoomMember => ({
  id: `empty-slot-${index}`,
  nickname: emptySlotLabel,
  isHost: false,
  isLocal: false,
  isEmptySlot: true,
  isMuted: false,
  presenceState: MemberPresenceState.Offline,
  speakingState: MemberSpeakingState.Silent,
  joinState: MemberJoinState.Waiting,
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
  joinState: MemberJoinState.Joined,
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
    members.filter((member) => !member.isEmptySlot).slice(0, MAX_ROOM_MEMBERS),
  );
  const paddedMembers = [...actualMembers];

  while (paddedMembers.length < MAX_ROOM_MEMBERS) {
    paddedMembers.push(createEmptySlot(paddedMembers.length));
  }

  return paddedMembers;
};

const countActualMembers = (members: RoomMember[]): number =>
  members.filter((member) => !member.isEmptySlot).length;

const areMembersEqual = (left: RoomMember[], right: RoomMember[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((member, index) => {
    const candidate = right[index];
    return candidate ? JSON.stringify(member) === JSON.stringify(candidate) : false;
  });
};

const initialHostEvents = (): HostEvent[] => [
  {
    id: "waiting-seed",
    level: "info",
    message: "等待好友加入",
    createdAt: new Date().toISOString(),
  },
];

const initialRoomState = (): RoomSummary => {
  const members = normalizeMembers([createLocalPreviewMember()]);
  return {
    roomId: "private-room",
    roomName: DEFAULT_ROOM_NAME,
    memberCount: countActualMembers(members),
    members,
    connectionMode: "direct_host",
    connectionState: RoomConnectionState.Idle,
    lifecycleState: RoomLifecycleState.Closed,
    hostSessionState: HostSessionState.NotStarted,
    recentHostEvents: initialHostEvents(),
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
  chatMessages: [],
  setConnectionState: (connectionState, reason) =>
    set((state) => ({
      room: {
        ...state.room,
        connectionState,
        latestFailureReason: reason ?? state.room.latestFailureReason,
      },
    })),
  setLifecycleState: (lifecycleState) =>
    set((state) => ({
      room: {
        ...state.room,
        lifecycleState,
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
      if (areMembersEqual(state.room.members, normalizedMembers)) {
        return state;
      }

      return {
        room: {
          ...state.room,
          members: normalizedMembers,
          memberCount: countActualMembers(normalizedMembers),
        },
      };
    }),
  setJoinSignalUrl: (joinSignalUrl) => set({ joinSignalUrl }),
  setHostSession: (hostSession) =>
    set((state) => ({
      hostSession,
      room: {
        ...state.room,
        hostSessionState: hostSession?.hostState ?? HostSessionState.NotStarted,
      },
    })),
  setConnectionMode: (connectionMode) =>
    set((state) => ({
      room: {
        ...state.room,
        connectionMode,
      },
    })),
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
  addChatMessage: (message) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, message].slice(-80),
    })),
  clearChatMessages: () => set({ chatMessages: [] }),
  syncLocalProfile: (profile) =>
    set((state) => {
      const members = state.room.members.filter((member) => !member.isEmptySlot);
      const localMemberIndex = members.findIndex((member) => member.isLocal);
      const existingLocalMember =
        localMemberIndex >= 0 ? members[localMemberIndex] : undefined;
      const baseMember = existingLocalMember ?? createLocalPreviewMember(profile);
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
      if (areMembersEqual(state.room.members, normalizedMembers)) {
        return state;
      }

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
  pushHostEvent: (event) =>
    set((state) => ({
      room: {
        ...state.room,
        recentHostEvents: [
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            ...event,
          },
          ...(state.room.recentHostEvents ?? []),
        ].slice(0, 8),
      },
    })),
  clearHostEvents: () =>
    set((state) => ({
      room: {
        ...state.room,
        recentHostEvents: [],
      },
    })),
  resetRoom: () =>
    set({
      room: initialRoomState(),
      hostSession: undefined,
      joinSignalUrl: "",
      localStream: undefined,
      remoteStreams: {},
      chatMessages: [],
      connectionHealth: {
        latencyMs: 0,
        jitterMs: 0,
        packetLossPercent: 0,
        reconnectAttempt: 0,
      },
    }),
}));
