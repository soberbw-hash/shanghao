import { CopyField } from "../base/CopyField";
import { SectionCard } from "../layout/SectionCard";

export const RoomCodePanel = ({ signalingUrl }: { signalingUrl?: string }) => (
  <SectionCard
    title="邀请地址"
    description="把这个地址发给你的固定好友，对方粘贴后就能加入。"
  >
    <CopyField value={signalingUrl || "先开启房间，地址会自动出现在这里"} />
  </SectionCard>
);
