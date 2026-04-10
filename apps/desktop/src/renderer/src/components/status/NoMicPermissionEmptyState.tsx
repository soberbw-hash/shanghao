import { EmptyState } from "../base/EmptyState";

export const NoMicPermissionEmptyState = () => (
  <EmptyState
    title="需要麦克风权限"
    description="先到 Windows 里允许麦克风访问，然后重新进入房间说话。"
  />
);
