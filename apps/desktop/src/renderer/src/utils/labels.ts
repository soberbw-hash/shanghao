import {
  MemberPresenceState,
  RecordingState,
  RoomConnectionState,
  TailscaleState,
} from "@private-voice/shared";

const roomConnectionLabels: Record<RoomConnectionState, string> = {
  [RoomConnectionState.Idle]: "空闲",
  [RoomConnectionState.DetectingNetwork]: "检测中",
  [RoomConnectionState.StartingHost]: "开启中",
  [RoomConnectionState.Joining]: "加入中",
  [RoomConnectionState.Connected]: "已连接",
  [RoomConnectionState.Reconnecting]: "重连中",
  [RoomConnectionState.Disconnected]: "已断开",
  [RoomConnectionState.Failed]: "失败",
};

const tailscaleLabels: Record<TailscaleState, string> = {
  [TailscaleState.Unknown]: "待检测",
  [TailscaleState.Checking]: "检测中",
  [TailscaleState.Installed]: "已安装",
  [TailscaleState.NotInstalled]: "未安装",
  [TailscaleState.Connected]: "已连接",
  [TailscaleState.Disconnected]: "未连接",
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

export const getTailscaleStateLabel = (state?: TailscaleState): string =>
  state ? tailscaleLabels[state] : "待检测";

export const getMemberPresenceLabel = (state: MemberPresenceState): string =>
  memberPresenceLabels[state];

export const getRecordingStateLabel = (state: RecordingState): string =>
  recordingStateLabels[state];
