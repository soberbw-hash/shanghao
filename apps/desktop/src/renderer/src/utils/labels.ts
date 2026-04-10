import {
  MemberPresenceState,
  RecordingState,
  RoomConnectionState,
  TailscaleState,
} from "@private-voice/shared";

const roomConnectionLabels: Record<RoomConnectionState, string> = {
  [RoomConnectionState.Idle]: "空闲",
  [RoomConnectionState.DetectingNetwork]: "正在检测网络",
  [RoomConnectionState.StartingHost]: "正在开房",
  [RoomConnectionState.Joining]: "正在加入",
  [RoomConnectionState.Connected]: "已连接",
  [RoomConnectionState.Reconnecting]: "正在重连",
  [RoomConnectionState.Disconnected]: "已断开",
  [RoomConnectionState.Failed]: "连接失败",
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
  [MemberPresenceState.Offline]: "未在线",
  [MemberPresenceState.Connecting]: "正在连接",
  [MemberPresenceState.Online]: "在线",
  [MemberPresenceState.Reconnecting]: "正在重连",
};

const recordingStateLabels: Record<RecordingState, string> = {
  [RecordingState.Idle]: "录音未开始",
  [RecordingState.Preparing]: "正在准备录音",
  [RecordingState.Recording]: "录音进行中",
  [RecordingState.Stopping]: "正在停止录音",
  [RecordingState.Saving]: "正在保存录音",
  [RecordingState.Saved]: "录音已保存",
  [RecordingState.Failed]: "录音失败",
};

export const getRoomConnectionLabel = (state: RoomConnectionState | string): string =>
  roomConnectionLabels[state as RoomConnectionState] ?? state;

export const getTailscaleStateLabel = (state?: TailscaleState): string =>
  state ? tailscaleLabels[state] : "待检测";

export const getMemberPresenceLabel = (state: MemberPresenceState): string =>
  memberPresenceLabels[state];

export const getRecordingStateLabel = (state: RecordingState): string =>
  recordingStateLabels[state];
