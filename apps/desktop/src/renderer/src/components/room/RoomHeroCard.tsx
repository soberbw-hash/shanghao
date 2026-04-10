import { CopyField } from "../base/CopyField";
import { Input } from "../base/Input";
import { GlassPanel } from "../layout/GlassPanel";
import { RoomActionButtons } from "./RoomActionButtons";

export const RoomHeroCard = ({
  roomName,
  joinSignalUrl,
  onJoinSignalUrlChange,
  onStartRoom,
  onJoinRoom,
}: {
  roomName: string;
  joinSignalUrl: string;
  onJoinSignalUrlChange: (value: string) => void;
  onStartRoom: () => void;
  onJoinRoom: () => void;
}) => (
  <GlassPanel className="grid gap-6 p-6 lg:grid-cols-[1.4fr_1fr]">
    <div className="space-y-4">
      <div>
        <div className="text-[28px] font-semibold text-white">{roomName}</div>
        <p className="mt-2 max-w-lg text-sm leading-6 text-white/55">
          Open one quiet room for your fixed group, then leave it when the session ends.
        </p>
      </div>
      <RoomActionButtons onStartRoom={onStartRoom} onJoinRoom={onJoinRoom} />
    </div>
    <div className="space-y-3 rounded-[18px] border border-white/8 bg-white/[0.04] p-4">
      <div className="text-sm font-medium text-white">Join with a host address</div>
      <Input
        placeholder="ws://100.x.x.x:4242"
        value={joinSignalUrl}
        onChange={(event) => onJoinSignalUrlChange(event.target.value)}
      />
      {joinSignalUrl ? <CopyField value={joinSignalUrl} /> : null}
    </div>
  </GlassPanel>
);
