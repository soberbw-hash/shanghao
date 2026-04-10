import { EmptyState } from "../base/EmptyState";

export const JoinRoomEmptyState = () => (
  <EmptyState
    title="No host address yet"
    description="Paste the host's Tailscale room address, then join the room when your group is ready."
  />
);
