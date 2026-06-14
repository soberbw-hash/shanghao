import { Bell, Settings2, UserPlus, Users } from "lucide-react";
import { motion } from "framer-motion";

import { MemberSpeakingState, RoomConnectionState } from "@private-voice/shared";

import { Button } from "../base/Button";
import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";

const statusCopy = (state: RoomConnectionState) => {
  if (state === RoomConnectionState.Reconnecting || state === RoomConnectionState.Degraded) return "正在回来…";
  if (state === RoomConnectionState.Failed || state === RoomConnectionState.Disconnected) return "暂时没连上";
  if (state === RoomConnectionState.Joining || state === RoomConnectionState.Handshaking || state === RoomConnectionState.WaitingSnapshot) return "正在进入频道";
  if (state === RoomConnectionState.WaitingPeer || state === RoomConnectionState.Connected) return "连接稳定";
  return "开黑频道";
};

export const TopStatusBar = ({
  onKnock,
  onInvite,
}: {
  variant?: "compact" | "room";
  onCopyInvite?: () => void;
  onKnock?: () => void;
  onInvite?: () => void;
}) => {
  const navigate = useAppStore((state) => state.navigate);
  const room = useRoomStore((state) => state.room);
  const speaking = room.members.find((member) => member.speakingState === MemberSpeakingState.Speaking);

  return (
    <header className="room-topbar flex items-center gap-3 px-4 py-3" data-testid="channel-status-bar">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="whitespace-nowrap text-[18px] font-[740] tracking-[-0.03em] text-[#1d2939]">开黑频道</h1>
          <span className="h-2 w-2 rounded-full bg-[#18b669] shadow-[0_0_12px_rgba(24,182,105,.55)]" />
        </div>
        <motion.div key={speaking?.id || statusCopy(room.connectionState)} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} className="mt-0.5 truncate text-xs text-[#7d8da2]">
          {speaking ? `${speaking.nickname}正在说话` : statusCopy(room.connectionState)}
        </motion.div>
      </div>
      <div className="status-capsule">
        <Users className="h-3.5 w-3.5" />
        {room.memberCount}/5 在线
      </div>
      <Button variant="ghost" className="h-9 whitespace-nowrap px-3" onClick={onKnock}>
        <Bell className="h-4 w-4" />
        敲一下
      </Button>
      <Button variant="ghost" className="h-9 whitespace-nowrap px-3" onClick={onInvite}>
        <UserPlus className="h-4 w-4" />
        邀请
      </Button>
      <Button variant="ghost" className="h-9 whitespace-nowrap px-3" onClick={() => navigate("settings")}>
        <Settings2 className="h-4 w-4" />
        设置
      </Button>
    </header>
  );
};
