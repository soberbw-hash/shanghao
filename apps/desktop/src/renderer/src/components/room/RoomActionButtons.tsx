import { Radio } from "lucide-react";

import { Button } from "../base/Button";

export const RoomActionButtons = ({
  onStartRoom,
  isStarting,
  isJoining,
}: {
  onStartRoom: () => void;
  isStarting?: boolean;
  isJoining?: boolean;
}) => (
  <div className="flex flex-wrap gap-3">
    <Button onClick={onStartRoom} disabled={Boolean(isStarting || isJoining)}>
      <Radio className="h-4 w-4" />
      {isStarting ? "正在开启…" : "开启房间"}
    </Button>
  </div>
);
