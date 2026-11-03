export const copy = {
  joinTitle: "进入频道失败",
  joinedTitle: "已进入开黑频道",
  joinedDescription: "好友上线后会自动出现在队伍里。",
  missingServerUrl: "还没有服务器地址，请先填写 ws:// 或 wss:// 开头的地址。",
  invalidServerUrl: "服务器地址要以 ws:// 或 wss:// 开头，不是 http://。",
  roomFull: "频道满了，最多 5 人同时语音。",
  networkFailed: "无法连接服务器，请检查地址、端口和防火墙。",
  socketClosed: "服务器连接被关闭，请确认服务端正在运行。",
  joinAckTimeout: "频道服务器已连接，但没有返回进房确认，请检查频道服务器是否已部署当前版本。",
  snapshotTimeout: "已进入频道，但同步成员超时，请重试。",
  versionMismatch: "当前版本太旧，请更新后再进入频道。",
  relayProtocolMismatch: "客户端与频道服务器版本不匹配，请更新频道服务器后再试。",
  relayAuthRequired: "频道服务器需要登录，请先登录上号账号。",
  relayAuthFailed: "登录状态已过期，请重新登录后再进入频道。",
  microphoneUnavailable: "麦克风不可用",
  microphonePermission:
    "麦克风访问未获允许。请在 Windows 设置 → 隐私和安全性 → 麦克风中开启麦克风访问及桌面应用访问，然后重启上号。",
  microphoneMissing: "没有找到可用的麦克风。",
  microphoneBusy: "麦克风暂时无法读取。请检查设备连接、RODE Connect 输入和是否被其他程序独占。",
  inputDeviceFailed: "输入设备切换失败",
  copiedInviteDescription: "把邀请发给朋友，点击链接或输入频道号即可加入。",
} as const;

export const normalizeServerUrl = (value?: string): string => {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error("missing_server_url");
  }

  const url = new URL(trimmed);
  if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error("invalid_server_url");
  }
  url.hash = "";
  return url.toString();
};

export const normalizeRoomError = (error: unknown, fallback: string): string => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") return copy.microphonePermission;
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return copy.microphoneMissing;
    }
    if (error.name === "NotReadableError") return copy.microphoneBusy;
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (!message) return fallback;
    if (message === "missing_server_url") return copy.missingServerUrl;
    if (message === "invalid_server_url" || message === "Invalid URL") {
      return copy.invalidServerUrl;
    }
    if (message.includes("version")) return copy.versionMismatch;
    if (message === "relay_protocol_mismatch") return copy.relayProtocolMismatch;
    if (message === "relay_auth_required") return copy.relayAuthRequired;
    if (message === "relay_auth_failed") return copy.relayAuthFailed;
    if (message.includes("room_full")) return copy.roomFull;
    if (message === "avatar_taken") return "这个角色刚被朋友选走了，请换一个角色再进入频道。";
    if (message === "network_unreachable") return copy.networkFailed;
    if (message === "signaling_socket_closed") return copy.socketClosed;
    if (message === "join_ack_timeout") return copy.joinAckTimeout;
    if (message === "room_snapshot_timeout") return copy.snapshotTimeout;
    if (message === "signaling_not_connected") return "连接还没恢复，请稍后再试。";
    return message;
  }

  return fallback;
};
