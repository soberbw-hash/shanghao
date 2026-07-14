import { Users, Wifi } from "lucide-react";
import { motion } from "framer-motion";

import {
  APPLE_MOTION_DURATION,
  APPLE_MOTION_EASE,
  MemberSpeakingState,
  RoomConnectionState,
} from "@private-voice/shared";

import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";
import { Button } from "../base/Button";
import { AnimatedControlIcon } from "../icons/AnimatedControlIcon";

const statusCopy = (state: RoomConnectionState) => {
  if (state === RoomConnectionState.Reconnecting) return "正在恢复连接...";
  if (state === RoomConnectionState.Degraded) return "语音已切换备用通道";
  if (state === RoomConnectionState.Failed || state === RoomConnectionState.Disconnected)
    return "连接断开";
  if (
    state === RoomConnectionState.Joining ||
    state === RoomConnectionState.Handshaking ||
    state === RoomConnectionState.WaitingSnapshot
  )
    return "进入中...";
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
  const latencyMs = useRoomStore((state) => state.connectionHealth.latencyMs);
  const speaking = room.members.find(
    (member) => !member.isEmptySlot && member.speakingState === MemberSpeakingState.Speaking,
  );

  const openSettings = () => {
    setSettingsReturnTo("room");
    navigate("settings");
  };
  const hasLatency = Number.isFinite(latencyMs) && latencyMs > 0;
  const roundedLatency = Math.max(0, Math.round(latencyMs));
  const latencyTone = roundedLatency <= 80 ? "good" : roundedLatency <= 180 ? "fair" : "poor";

  return (
    <header
      className="room-topbar flex items-center gap-3 px-4 py-2.5"
      data-testid="channel-status-bar"
    >
      <div className="topbar-channel min-w-0 flex-1">
        <div className="topbar-channel-title flex items-center gap-2">
          <h1 className="whitespace-nowrap text-[15px] font-[700] tracking-[-0.02em] text-[#1a2332]">
            开黑频道
          </h1>
          <span
            className={`channel-status-dot ${statusTone(room.connectionState)}`}
            aria-label={statusCopy(room.connectionState)}
          />
        </div>
        <motion.div
          key={speaking?.id || statusCopy(room.connectionState)}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: APPLE_MOTION_DURATION.feedback, ease: APPLE_MOTION_EASE }}
          className="topbar-channel-copy mt-0.5 truncate text-[11px] text-[#8494a7]"
        >
          {speaking ? `${speaking.nickname} 说话中` : statusCopy(room.connectionState)}
        </motion.div>
      </div>
      <div className="topbar-controls">
        <div className="topbar-metrics" aria-label="频道状态">
          <div className="status-capsule topbar-metric">
            <Users className="h-3 w-3" />
            {room.memberCount}/5
          </div>
          <div
            className={`connection-quality-capsule topbar-metric ${hasLatency ? latencyTone : "pending"}`}
            title={hasLatency ? `服务器往返延迟 ${roundedLatency} 毫秒` : "正在获取服务器延迟"}
            aria-label={hasLatency ? `服务器延迟 ${roundedLatency} 毫秒` : "正在获取服务器延迟"}
          >
            <Wifi className="h-3 w-3" />
            {hasLatency ? `${roundedLatency} ms` : "-- ms"}
          </div>
        </div>
        <div className="topbar-actions">
          <Button
            variant="ghost"
            data-icon-motion="knock"
            className="topbar-action h-8 whitespace-nowrap px-3 text-[12px]"
            onClick={onKnock}
          >
            <AnimatedControlIcon name="bell" className="h-3.5 w-3.5" />
            <span>敲一下</span>
          </Button>
          <Button
            variant="ghost"
            data-icon-motion="invite"
            className="topbar-action h-8 whitespace-nowrap px-3 text-[12px]"
            onClick={onInvite}
          >
            <AnimatedControlIcon name="invite" className="h-3.5 w-3.5" />
            <span>邀请</span>
          </Button>
          <Button
            variant="ghost"
            data-icon-motion="settings"
            className="topbar-action h-8 whitespace-nowrap px-3 text-[12px]"
            onClick={openSettings}
          >
            <AnimatedControlIcon name="settings" className="h-3.5 w-3.5" />
            <span>设置</span>
          </Button>
        </div>
      </div>
    </header>
  );
};
