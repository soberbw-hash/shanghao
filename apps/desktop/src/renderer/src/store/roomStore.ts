import { create } from "zustand";

import {
  DEFAULT_ROOM_NAME,
  MAX_ROOM_MEMBERS,
  MemberJoinState,
  MemberPresenceState,
  MemberSpeakingState,
  RoomConnectionState,
  RoomLifecycleState,
  type BuiltInAvatarId,
  type ChatMessage,
  type ConnectionHealth,
  type MemberActivity,
  type RoomEvent,
  type RoomMember,
  type RoomSummary,
  type SceneZoneId,
  type SceneReaction,
} from "@private-voice/shared";

interface LocalProfilePayload {
  nickname?: string;
  avatarPath?: string;
  avatarDataUrl?: string;
  avatarId?: BuiltInAvatarId;
}

export interface RemoteScreenFrame {
  data: string;
  width: number;
  height: number;
  sequence: number;
  receivedAt: string;
}

interface RoomStoreState {
  room: RoomSummary;
  localStream?: MediaStream;
  remoteStreams: Record<string, MediaStream>;
  remoteScreenFrames: Record<string, RemoteScreenFrame>;
  connectionHealth: ConnectionHealth;
  chatMessages: ChatMessage[];
  sceneReactions: SceneReaction[];
  setConnectionState: (state: RoomConnectionState, reason?: string) => void;
  setLifecycleState: (state: RoomLifecycleState) => void;
  setRoom: (room: Partial<RoomSummary>) => void;
  setMembers: (members: RoomMember[]) => void;
  setLocalStream: (stream?: MediaStream) => void;
  setRemoteStream: (peerId: string, stream?: MediaStream) => void;
  setRemoteScreenFrame: (peerId: string, frame?: RemoteScreenFrame) => void;
  setConnectionHealth: (health: Partial<ConnectionHealth>) => void;
  addChatMessage: (message: ChatMessage) => void;
  mergeChatHistory: (messages: ChatMessage[]) => void;
  addSceneReaction: (reaction: SceneReaction) => void;
  syncLocalProfile: (profile: LocalProfilePayload) => void;
  updateMemberVolume: (memberId: string, volume: number) => void;
  updatePeerLatency: (memberId: string, latencyMs?: number) => void;
  updateLocalPresence: (presence: {
    isMuted?: boolean;
    isDeafened?: boolean;
    activity?: MemberActivity;
    sceneZone?: SceneZoneId;
    gameName?: string;
  }) => void;
  pushRoomEvent: (event: Omit<RoomEvent, "id" | "createdAt">) => void;
  clearRoomEvents: () => void;
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
  isDeafened: false,
  activity: "idle",
  sceneZone: "gameDesk1",
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
  avatarId: profile?.avatarId,
  isHost: false,
  isLocal: true,
  isMuted: false,
  isDeafened: false,
  activity: "idle",
  sceneZone: "gameDesk1",
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

const initialRoomEvents = (): RoomEvent[] => [
  {
    id: "waiting-seed",
    level: "info",
    message: "输入服务器地址后即可进入固定频道",
    createdAt: new Date().toISOString(),
  },
];

const initialRoomState = (): RoomSummary => {
  const members = normalizeMembers([createLocalPreviewMember()]);
  return {
    roomId: "main",
    roomName: DEFAULT_ROOM_NAME,
    memberCount: countActualMembers(members),
    members,
    connectionState: RoomConnectionState.Idle,
    lifecycleState: RoomLifecycleState.Closed,
    recentRoomEvents: initialRoomEvents(),
  };
};

export const useRoomStore = create<RoomStoreState>((set) => ({
  room: initialRoomState(),
  localStream: undefined,
  remoteStreams: {},
  remoteScreenFrames: {},
  connectionHealth: {
    latencyMs: 0,
    jitterMs: 0,
    packetLossPercent: 0,
    reconnectAttempt: 0,
  },
  chatMessages: [],
  sceneReactions: [],
  setConnectionState: (connectionState, reason) =>
    set((state) => ({
      room: {
        ...state.room,
        connectionState,
        latestFailureReason:
          typeof reason === "string"
            ? reason
            : connectionState === RoomConnectionState.Failed
              ? state.room.latestFailureReason
              : undefined,
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
      const previousById = new Map(
        state.room.members
          .filter((member) => !member.isEmptySlot)
          .map((member) => [member.id, member]),
      );
      const normalizedMembers = normalizeMembers(
        members.map((member) => {
          const previous = previousById.get(member.id);
          return {
            ...member,
            latencyMs: member.latencyMs ?? previous?.latencyMs,
          };
        }),
      );
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
  setRemoteScreenFrame: (peerId, frame) =>
    set((state) => {
      const nextRemoteScreenFrames = { ...state.remoteScreenFrames };
      if (frame) {
        nextRemoteScreenFrames[peerId] = frame;
      } else {
        delete nextRemoteScreenFrames[peerId];
      }
      return { remoteScreenFrames: nextRemoteScreenFrames };
    }),
  setConnectionHealth: (healthPatch) =>
    set((state) => ({
      connectionHealth: {
        ...state.connectionHealth,
        ...healthPatch,
      },
    })),
  addChatMessage: (message) =>
    set((state) => {
      const byId = new Map(state.chatMessages.map((item) => [item.id, item]));
      byId.set(message.id, message);
      return {
        chatMessages: [...byId.values()]
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .slice(-100),
      };
    }),
  mergeChatHistory: (messages) =>
    set((state) => {
      const byId = new Map(state.chatMessages.map((item) => [item.id, item]));
      for (const message of messages) byId.set(message.id, message);
      return {
        chatMessages: [...byId.values()]
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .slice(-100),
      };
    }),
  addSceneReaction: (reaction) =>
    set((state) => ({
      sceneReactions: [...state.sceneReactions, reaction].slice(-20),
    })),
  syncLocalProfile: (profile) =>
    set((state) => {
      const members = state.room.members.filter((member) => !member.isEmptySlot);
      const localMemberIndex = members.findIndex((member) => member.isLocal);
      const existingLocalMember = localMemberIndex >= 0 ? members[localMemberIndex] : undefined;
      const baseMember = existingLocalMember ?? createLocalPreviewMember(profile);
      const nextLocalMember: RoomMember = {
        ...baseMember,
        nickname: profile.nickname?.trim() || baseMember.nickname || localMemberLabel,
        avatarPath: profile.avatarPath,
        avatarDataUrl: profile.avatarDataUrl,
        avatarId: profile.avatarId,
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
  updatePeerLatency: (memberId, latencyMs) =>
    set((state) => ({
      room: {
        ...state.room,
        members: state.room.members.map((member) =>
          member.id === memberId ? { ...member, latencyMs } : member,
        ),
      },
    })),
  updateLocalPresence: (presence) =>
    set((state) => ({
      room: {
        ...state.room,
        members: state.room.members.map((member) =>
          member.isLocal ? { ...member, ...presence } : member,
        ),
      },
    })),
  pushRoomEvent: (event) =>
    set((state) => ({
      room: {
        ...state.room,
        recentRoomEvents: [
          {
            id: crypto.randomUUID(),
            createdAt: new Date().toISOString(),
            ...event,
          },
          ...(state.room.recentRoomEvents ?? []),
        ].slice(0, 8),
      },
    })),
  clearRoomEvents: () =>
    set((state) => ({
      room: {
        ...state.room,
        recentRoomEvents: [],
      },
    })),
  resetRoom: () =>
    set({
      room: initialRoomState(),
      localStream: undefined,
      remoteStreams: {},
      remoteScreenFrames: {},
      chatMessages: [],
      sceneReactions: [],
      connectionHealth: {
        latencyMs: 0,
        jitterMs: 0,
        packetLossPercent: 0,
        reconnectAttempt: 0,
      },
    }),
}));
