import {
  MemberSpeakingState,
  MemberPresenceState,
  RoomConnectionState,
  RoomLifecycleState,
  type ConnectionHealth,
  type HostSessionInfo,
  type RoomMember,
  type RoomSummary,
} from "@private-voice/shared";
import { create } from "zustand";

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
  resetRoom: () => void;
}

const placeholderMembers: RoomMember[] = Array.from({ length: 5 }, (_, index) => ({
  id: `placeholder-${index}`,
  nickname: index === 0 ? "You" : "Invite slot",
  isHost: index === 0,
  isLocal: index === 0,
  isMuted: false,
  presenceState: index === 0 ? MemberPresenceState.Online : MemberPresenceState.Offline,
  speakingState: MemberSpeakingState.Silent,
  volume: 1,
  joinedAt: new Date().toISOString(),
  connectionQuality: "good",
}));

const initialRoomState = (): RoomSummary => ({
  roomId: "private-room",
  roomName: "Private Lounge",
  memberCount: 1,
  members: placeholderMembers,
  connectionState: RoomConnectionState.Idle,
  lifecycleState: RoomLifecycleState.Closed,
});

export const useRoomStore = create<RoomStoreState>((set) => ({
  room: initialRoomState(),
  hostSession: undefined,
  joinSignalUrl: "",
  localStream: undefined,
  remoteStreams: {},
  connectionHealth: {
    latencyMs: 32,
    jitterMs: 4,
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
    set((state) => ({
      room: {
        ...state.room,
        members,
        memberCount: members.length,
      },
    })),
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
  resetRoom: () =>
    set({
      room: initialRoomState(),
      hostSession: undefined,
      joinSignalUrl: "",
      localStream: undefined,
      remoteStreams: {},
      connectionHealth: {
        latencyMs: 32,
        jitterMs: 4,
        packetLossPercent: 0,
        reconnectAttempt: 0,
      },
    }),
}));
