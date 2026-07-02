import { Bell, Settings2, UserPlus, Users } from "lucide-react";
import { motion } from "framer-motion";

import { MemberSpeakingState, RoomConnectionState } from "@private-voice/shared";

import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";
import { Button } from "../base/Button";

const statusCopy = (state: RoomConnectionState) => {
  if (state === RoomConnectionState.Reconnecting || state === RoomConnectionState.Degraded) return "重新连接中...";
  if (state === RoomConnectionState.Failed || state === RoomConnectionState.Disconnected) return "连接断开";
  if (
    state === RoomConnectionState.Joining ||
    state === RoomConnectionState.Handshaking ||
    state === RoomConnectionState.WaitingSnapshot
  ) return "进入中...";
  if (state === RoomConnectionState.WaitingPeer) return "等待好友上线";
  if (state === RoomConnectionState.Connected) return "频道空闲中";
  return "开黑频道";
};

const statusTone = (state: RoomConnectionState) => {
  if (state === RoomConnectionState.Connected || state === RoomConnectionState.WaitingPeer) {
    return "online";
  }
  if (
    state === RoomConnectionState.Reconnecting ||
    state === RoomConnectionState.Degraded ||
    state === RoomConnectionState.Joining ||
    state === RoomConnectionState.Handshaking ||
    state === RoomConnectionState.WaitingSnapshot
  ) {
    return "pending";
  }
  if (state === RoomConnectionState.Failed || state === RoomConnectionState.Disconnected) {
    return "offline";
  }
  return "neutral";
};

export const TopStatusBar = ({
  onKnock,
  onInvite,
}: {
  onKnock?: () => void;
  onInvite?: () => void;
}) => {
  const navigate = useAppStore((state) => state.navigate);
  const setSettingsReturnTo = useAppStore((state) => state.setSettingsReturnTo);
  const room = useRoomStore((state) => state.room);
  const speaking = room.members.find(
    (member) => !member.isEmptySlot && member.speakingState === MemberSpeakingState.Speaking,
  );

  const openSettings = () => {
    setSettingsReturnTo("room");
    navigate("settings");
  };

  return (
    <header className="room-topbar flex items-center gap-3 px-4 py-2.5" data-testid="channel-status-bar">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="whitespace-nowrap text-[15px] font-[700] tracking-[-0.02em] text-[#1a2332]">开黑频道</h1>
          <span
            className={`channel-status-dot ${statusTone(room.connectionState)}`}
            aria-label={statusCopy(room.connectionState)}
          />
        </div>
        <motion.div
          key={speaking?.id || statusCopy(room.connectionState)}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-0.5 truncate text-[11px] text-[#8494a7]"
        >
          {speaking ? `${speaking.nickname} 说话中` : statusCopy(room.connectionState)}
        </motion.div>
      </div>
      <div className="status-capsule">
        <Users className="h-3 w-3" />
        {room.memberCount}/5
      </div>
      <Button variant="ghost" className="h-8 whitespace-nowrap px-3 text-[12px]" onClick={onKnock}>
        <Bell className="h-3.5 w-3.5" />
        敲一下
      </Button>
      <Button variant="ghost" className="h-8 whitespace-nowrap px-3 text-[12px]" onClick={onInvite}>
        <UserPlus className="h-3.5 w-3.5" />
        邀请
      </Button>
      <Button variant="ghost" className="h-8 whitespace-nowrap px-3 text-[12px]" onClick={openSettings}>
        <Settings2 className="h-3.5 w-3.5" />
        设置
      </Button>
    </header>
  );
};
