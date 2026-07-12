import { MemberPresenceState, RecordingState, RoomConnectionState } from "@private-voice/shared";

const roomConnectionLabels: Record<RoomConnectionState, string> = {
  [RoomConnectionState.Idle]: "待命",
  [RoomConnectionState.DetectingNetwork]: "检测中",
  [RoomConnectionState.StartingHost]: "开启中",
  [RoomConnectionState.WaitingPeer]: "等待加入",
  [RoomConnectionState.Joining]: "加入中",
  [RoomConnectionState.Handshaking]: "握手中",
  [RoomConnectionState.WaitingSnapshot]: "同步成员中",
  [RoomConnectionState.Connected]: "已连接",
  [RoomConnectionState.Reconnecting]: "重连中",
  [RoomConnectionState.Degraded]: "连接波动",
  [RoomConnectionState.Disconnected]: "已断开",
  [RoomConnectionState.Failed]: "失败",
};

const memberPresenceLabels: Record<MemberPresenceState, string> = {
  [MemberPresenceState.Offline]: "离线",
  [MemberPresenceState.Connecting]: "连接中",
  [MemberPresenceState.Online]: "在线",
  [MemberPresenceState.Reconnecting]: "重连中",
};

const recordingStateLabels: Record<RecordingState, string> = {
  [RecordingState.Idle]: "未录音",
  [RecordingState.Preparing]: "准备中",
  [RecordingState.Recording]: "录音中",
  [RecordingState.Stopping]: "停止中",
  [RecordingState.Saving]: "保存中",
  [RecordingState.Saved]: "已保存",
  [RecordingState.Failed]: "保存失败",
};

export const getRoomConnectionLabel = (state: RoomConnectionState | string): string =>
  roomConnectionLabels[state as RoomConnectionState] ?? state;

export const getMemberPresenceLabel = (state: MemberPresenceState): string =>
  memberPresenceLabels[state];

export const getRecordingStateLabel = (state: RecordingState): string =>
  recordingStateLabels[state];

export const getPrimaryRoomStatus = ({
  connectionState,
  memberCount,
}: {
  connectionState: RoomConnectionState;
  memberCount: number;
}): {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger" | "accent";
} => {
  if (connectionState === RoomConnectionState.WaitingPeer) {
    return { label: "等待加入", tone: "accent" };
  }

  if (connectionState === RoomConnectionState.Joining) {
    return { label: "加入中", tone: "accent" };
  }

  if (connectionState === RoomConnectionState.Handshaking) {
    return { label: "握手中", tone: "accent" };
  }

  if (connectionState === RoomConnectionState.WaitingSnapshot) {
    return { label: "已连接，正在同步成员", tone: "accent" };
  }

  if (connectionState === RoomConnectionState.Reconnecting) {
    return { label: "重连中", tone: "warning" };
  }

  if (connectionState === RoomConnectionState.Degraded) {
    return { label: "语音可用，信令重连中", tone: "warning" };
  }

  if (connectionState === RoomConnectionState.Failed) {
    return { label: "连接失败", tone: "danger" };
  }

  if (connectionState === RoomConnectionState.Connected && memberCount <= 1) {
    return { label: "等待加入", tone: "accent" };
  }

  if (connectionState === RoomConnectionState.Connected) {
    return { label: "已连接", tone: "success" };
  }

  if (connectionState === RoomConnectionState.Disconnected) {
    return { label: "已断开", tone: "neutral" };
  }

  return { label: "待命", tone: "neutral" };
};
