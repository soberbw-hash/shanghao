import { EmptyState } from "../base/EmptyState";

export const NoDeviceEmptyState = () => (
  <EmptyState
    title="No audio device found"
    description="Connect a microphone or speaker, then refresh devices from Settings."
  />
);
