import { CopyField } from "../base/CopyField";
import { SectionCard } from "../layout/SectionCard";

export const RoomCodePanel = ({ signalingUrl }: { signalingUrl?: string }) => (
  <SectionCard
    title="Invite address"
    description="Share this Tailscale or local address with the rest of your group."
  >
    <CopyField value={signalingUrl || "Start hosting to generate an address"} />
  </SectionCard>
);
