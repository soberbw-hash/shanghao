import { ArrowRight, DoorOpen, Radio } from "lucide-react";

import { Button } from "../base/Button";

export const RoomActionButtons = ({
  onStartRoom,
  onJoinRoom,
}: {
  onStartRoom: () => void;
  onJoinRoom: () => void;
}) => (
  <div className="flex flex-wrap gap-3">
    <Button onClick={onStartRoom}>
      <Radio className="h-4 w-4" />
      开启房间
    </Button>
    <Button variant="secondary" onClick={onJoinRoom}>
      <DoorOpen className="h-4 w-4" />
      加入房间
      <ArrowRight className="h-4 w-4" />
    </Button>
  </div>
);
