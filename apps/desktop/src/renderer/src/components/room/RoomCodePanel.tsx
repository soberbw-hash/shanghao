import { CopyField } from "../base/CopyField";
import { SectionCard } from "../layout/SectionCard";

export const RoomCodePanel = ({ signalingUrl }: { signalingUrl?: string }) => (
  <SectionCard
    title="邀请地址"
    description="把这个 Tailscale 或局域网地址发给你的固定好友。"
  >
    <CopyField value={signalingUrl || "先开启房间，随后这里会生成可分享地址"} />
  </SectionCard>
);
