import { EmptyState } from "../base/EmptyState";

export const NoMicPermissionEmptyState = () => (
  <EmptyState
    title="需要麦克风权限"
    description="先在 Windows 里允许麦克风访问，然后再回到上号。"
  />
);
