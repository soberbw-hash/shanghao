const messages: Record<string, string> = {
  temporary_rate_limited: "尝试太频繁，请稍后再试。",
  temporary_bridge_rate_limited: "尝试太频繁，请稍后再试。",
  temporary_room_not_found: "房间码不存在或房间已结束。",
  temporary_room_full: "房间已有五人，请稍后再试。",
  temporary_room_locked: "房主已锁定房间，暂时不能加入。",
  temporary_member_removed: "你已被移出这个临时房间。",
  temporary_already_joined: "请先退出当前临时房间。",
  temporary_version_conflict: "房间状态刚有变化，请重试。",
  temporary_admin_required: "只有当前房主可以修改。",
  temporary_identity_encryption_unavailable: "系统安全存储暂不可用，请重启上号后重试。",
  temporary_profile_required: "请先填写临时昵称。",
  temporary_room_code_invalid: "请输入八位数字房间码。",
  temporary_secure_connection_required: "临时联机需要安全的服务器连接。",
  temporary_lan_code_ambiguous: "局域网中有重复房间码，请房主更换房间码后重试。",
  temporary_lan_authority_ambiguous: "房间连接状态有冲突，请稍后重试。",
  temporary_lan_authority_changed: "房间连接刚有变化，请重新加入。",
  temporary_discovery_bind_failed: "局域网发现暂不可用，请检查上号的网络权限。",
  temporary_internet_bridge_unavailable: "当前仅局域网可用，公网服务尚未支持或暂时无法连接。",
};
export function temporaryRoomMessage(error: unknown): string {
  const code = error instanceof Error ? error.message.match(/temporary_[a-z_]+/)?.[0] : "";
  return messages[code ?? ""] ?? "临时联机连接失败，请稍后重试。";
}
