import { EmptyState } from "../base/EmptyState";

export const NoMicPermissionEmptyState = () => (
  <EmptyState
    title="Microphone access is required"
    description="Allow microphone permission in Windows and relaunch the room to speak."
  />
);
