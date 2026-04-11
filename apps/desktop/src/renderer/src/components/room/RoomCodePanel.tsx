import { CopyField } from "../base/CopyField";
import { SectionCard } from "../layout/SectionCard";

export const RoomCodePanel = ({
  signalingUrl,
  onCopy,
}: {
  signalingUrl?: string;
  onCopy?: () => void;
}) => (
  <SectionCard
    title="房间地址"
    description="把这份地址发给固定朋友，对方粘贴后就能加入。"
  >
    <CopyField value={signalingUrl || "先开启房间，地址会显示在这里"} onCopy={onCopy} />
  </SectionCard>
);
