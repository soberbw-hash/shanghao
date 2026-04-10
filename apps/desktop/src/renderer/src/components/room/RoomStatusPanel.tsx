import { RoomConnectionState } from "@private-voice/shared";

import { StatusPill } from "../base/StatusPill";

export const RoomStatusPanel = ({
  roomName,
  memberCount,
  connectionState,
}: {
  roomName: string;
  memberCount: number;
  connectionState: string;
}) => (
  <div className="grid gap-3 md:grid-cols-3">
    <div className="rounded-[16px] border border-white/8 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-white/35">Room</div>
      <div className="mt-2 text-base font-medium text-white">{roomName}</div>
    </div>
    <div className="rounded-[16px] border border-white/8 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-white/35">Members</div>
      <div className="mt-2 text-base font-medium text-white">{memberCount} / 5</div>
    </div>
    <div className="rounded-[16px] border border-white/8 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-white/35">Connection</div>
      <div className="mt-2">
        <StatusPill
          tone={connectionState === RoomConnectionState.Connected ? "success" : "accent"}
        >
          {connectionState.replaceAll("_", " ")}
        </StatusPill>
      </div>
    </div>
  </div>
);
