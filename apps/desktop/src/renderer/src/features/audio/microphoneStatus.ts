import { AudioDeviceState, MicPermissionState, RoomConnectionState } from "@private-voice/shared";

export type MicrophoneTrackStatus = Pick<MediaStreamTrack, "readyState" | "enabled" | "muted">;
export interface MicrophoneStatus {
  capture:
    | "muted"
    | "push-to-talk"
    | "paused"
    | "active"
    | "interrupted"
    | "permission"
    | "missing"
    | "unavailable"
    | "preparing";
  label: string;
  detail: string;
  tone: "neutral" | "warning";
}

/** Describe observed local capture, never infer remote playback from a waveform. */
export const getMicrophoneStatus = (input: {
  isMuted: boolean;
  pushToTalkWaiting: boolean;
  permission: MicPermissionState;
  inputState: AudioDeviceState;
  connection: RoomConnectionState;
  tracks: MicrophoneTrackStatus[];
  inputLost: boolean;
}): MicrophoneStatus => {
  const live = input.tracks.filter((track) => track.readyState === "live");
  let capture: MicrophoneStatus["capture"];
  let label: string;
  let detail: string;
  let tone: MicrophoneStatus["tone"] = "neutral";
  if (input.isMuted) {
    capture = "muted";
    label = "未发送";
    detail = "麦克风已静音，不发送本机声音。";
  } else if (
    input.inputLost ||
    (input.tracks.length > 0 && live.length === 0) ||
    live.some((track) => track.muted)
  ) {
    capture = "interrupted";
    label = "输入中断";
    detail = "本机音频输入已中断。请检查设备连接，并从麦克风菜单重新选择设备或运行体检。";
    tone = "warning";
  } else if (live.length === 0 && input.permission === MicPermissionState.Denied) {
    capture = "permission";
    label = "权限未允许";
    detail = "麦克风访问未获允许，请检查 Windows 麦克风权限。";
    tone = "warning";
  } else if (live.length === 0 && input.inputState === AudioDeviceState.Missing) {
    capture = "missing";
    label = "未找到设备";
    detail = "未找到麦克风设备，请检查连接，并从麦克风菜单选择输入设备。";
    tone = "warning";
  } else if (live.length === 0 && input.inputState === AudioDeviceState.Failed) {
    capture = "unavailable";
    label = "设备待检查";
    detail = "无法读取音频设备列表，请从麦克风菜单检查设备或运行体检。";
    tone = "warning";
  } else if (live.length === 0) {
    capture = "preparing";
    label = "等待采集";
    detail = "尚未观察到本机音频采集。可从麦克风菜单检查设备或运行体检。";
  } else if (input.pushToTalkWaiting) {
    capture = "push-to-talk";
    label = "等待按键";
    detail = "按键说话已开启，按住设置的快捷键后发送声音。";
  } else if (live.every((track) => !track.enabled)) {
    capture = "paused";
    label = "发送已暂停";
    detail = "本机音轨已暂停发送，请检查静音或按键说话状态。";
  } else {
    capture = "active";
    label = "采集已开启";
    detail = "本机音频采集已开启；安静时没有波形属于正常情况，不代表好友已经听到声音。";
  }

  if (input.connection === RoomConnectionState.Reconnecting) {
    detail += " 房间连接正在恢复，请留意顶部连接状态。";
    if (capture === "active") label = "连接恢复中";
    tone = "warning";
  } else if (
    [RoomConnectionState.Failed, RoomConnectionState.Disconnected].includes(input.connection)
  ) {
    detail += " 房间连接已断开，请检查网络并重新进入房间。";
    if (capture === "active") label = "连接已断开";
    tone = "warning";
  } else if (input.connection === RoomConnectionState.Degraded) {
    detail += " 房间正在使用备用语音通道。";
  }
  return { capture, label, detail, tone };
};
