import { EmptyState } from "../base/EmptyState";

export const JoinRoomEmptyState = () => (
  <EmptyState
    title="还没有房主地址"
    description="把房主通过 Tailscale 分享的房间地址粘贴到右侧输入框，然后再加入房间。"
  />
);
