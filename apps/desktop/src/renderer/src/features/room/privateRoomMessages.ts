const messages: Record<string, string> = {
  room_not_found: "房间已不存在。",
  room_code_unavailable: "这个频道号已被使用或仍在冷却期，请换一个。",
  room_limit_reached: "你已创建三个房间，请先删除不再使用的房间。",
  room_banned: "房主已禁止你加入这个房间。",
  room_removed: "你已被移出房间，可以稍后重新加入。",
  room_owner_required: "只有房主可以修改这个房间。",
  room_full: "房间已满，最多五人同时在线。",
  room_invalid_request: "请检查房间名称、图标和六位频道号。",
  room_service_unavailable: "房间服务暂时不可用，请稍后重试。",
  room_server_upgrade_required: "服务器需要更新后才能使用私人房间。",
  room_history_unreadable: "本地房间记录无法读取，原文件已保留。",
  room_rate_limited: "操作太频繁，请稍后重试。",
  room_busy: "上一项操作仍在进行，请稍后重试。",
  room_favorites_full: "收藏已达上限，请先取消不再需要的收藏。",
  account_session_expired: "请先登录后再使用私人房间。",
};
export const privateRoomErrorMessage = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error);
  const matched = Object.keys(messages).find((code) => text.includes(code));
  return matched ? messages[matched]! : "无法完成房间操作，请稍后重试。";
};
