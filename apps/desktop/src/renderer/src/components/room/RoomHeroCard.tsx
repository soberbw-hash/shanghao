import { Clipboard, Link2 } from "lucide-react";

import { Button } from "../base/Button";
import { Input } from "../base/Input";
import { GlassPanel } from "../layout/GlassPanel";
import { RoomActionButtons } from "./RoomActionButtons";

export const RoomHeroCard = ({
  roomName,
  joinSignalUrl,
  onJoinSignalUrlChange,
  onPasteSignalUrl,
  onStartRoom,
  onJoinRoom,
  isStarting,
  isJoining,
}: {
  roomName: string;
  joinSignalUrl: string;
  onJoinSignalUrlChange: (value: string) => void;
  onPasteSignalUrl: () => void;
  onStartRoom: () => void;
  onJoinRoom: () => void;
  isStarting?: boolean;
  isJoining?: boolean;
}) => (
  <GlassPanel className="grid gap-5 p-5 lg:grid-cols-[1.2fr_1fr]">
    <div className="flex flex-col justify-between gap-5">
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase tracking-[0.24em] text-[#98A2B3]">
          一间固定语音房
        </div>
        <div className="text-[clamp(24px,3vw,30px)] font-semibold text-[#111827]">
          {roomName}
        </div>
        <p className="max-w-lg text-sm leading-6 text-[#667085]">
          开房后把地址发给朋友，对方粘贴就能进来。没有频道，没有复杂入口。
        </p>
      </div>
      <RoomActionButtons
        onStartRoom={onStartRoom}
        isStarting={isStarting}
        isJoining={isJoining}
      />
    </div>
    <div className="rounded-[18px] border border-[#E7ECF2] bg-[#F8FAFC] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#111827]">
        <Link2 className="h-4 w-4 text-[#4DA3FF]" />
        加入房间
      </div>
      <div className="space-y-3">
        <Input
          placeholder="粘贴房主分享的地址"
          value={joinSignalUrl}
          onChange={(event) => onJoinSignalUrlChange(event.target.value)}
        />
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={onPasteSignalUrl}>
            <Clipboard className="h-4 w-4" />
            粘贴
          </Button>
          <Button onClick={onJoinRoom} disabled={Boolean(isStarting || isJoining || !joinSignalUrl.trim())}>
            {isJoining ? "加入中…" : "立即加入"}
          </Button>
        </div>
      </div>
    </div>
  </GlassPanel>
);
