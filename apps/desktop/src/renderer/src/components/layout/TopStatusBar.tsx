import { LoaderCircle, Settings2, Users, Wifi, WifiOff } from "lucide-react";
import { motion } from "framer-motion";

import { RoomConnectionState } from "@private-voice/shared";
import { Button, StatusPill } from "@private-voice/ui";

import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";

const statusCopy = (state: RoomConnectionState) => {
  if (state === RoomConnectionState.Reconnecting || state === RoomConnectionState.Degraded) {
    return { title: "正在重连", detail: "网络有波动", tone: "warning" as const };
  }
  if (state === RoomConnectionState.Failed || state === RoomConnectionState.Disconnected) {
    return { title: "连接失败", detail: "请检查网络", tone: "danger" as const };
  }
  if (
    state === RoomConnectionState.Joining ||
    state === RoomConnectionState.Handshaking ||
    state === RoomConnectionState.WaitingSnapshot ||
    state === RoomConnectionState.StartingHost
  ) {
    return { title: "正在进入", detail: "建立频道连接", tone: "neutral" as const };
  }
  if (state === RoomConnectionState.WaitingPeer || state === RoomConnectionState.Connected) {
    return { title: "连接稳定", detail: "语音频道在线", tone: "success" as const };
  }
  return { title: "开黑频道", detail: "准备上号", tone: "neutral" as const };
};

export const TopStatusBar = ({ variant = "compact" }: { variant?: "compact" | "room"; onCopyInvite?: () => void }) => {
  const navigate = useAppStore((state) => state.navigate);
  const room = useRoomStore((state) => state.room);
  const latencyMs = useRoomStore((state) => state.connectionHealth.latencyMs);
  const status = statusCopy(room.connectionState);
  const isBusy =
    room.connectionState === RoomConnectionState.Reconnecting ||
    room.connectionState === RoomConnectionState.Degraded ||
    room.connectionState === RoomConnectionState.Joining ||
    room.connectionState === RoomConnectionState.Handshaking ||
    room.connectionState === RoomConnectionState.WaitingSnapshot;

  return (
    <div
      className={`glass-panel flex items-center gap-4 rounded-[20px] px-4 py-3 ${
        variant === "room" ? "min-h-[72px]" : "min-h-[64px]"
      }`}
      data-testid="channel-status-bar"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
          {isBusy ? (
            <LoaderCircle className="h-5 w-5 animate-spin text-[#D08A12]" />
          ) : status.tone === "danger" ? (
            <WifiOff className="h-5 w-5 text-[#D92D20]" />
          ) : (
            <Wifi className="h-5 w-5 text-[#2B84E9]" />
          )}
        </div>
        <motion.div
          key={`${status.title}-${status.detail}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="min-w-0"
        >
          <div className="text-base font-semibold text-[#111827]">{status.title}</div>
          <div className="mt-0.5 text-xs text-[#667085]">{status.detail}</div>
        </motion.div>
      </div>
      <StatusPill tone="neutral">
        <Users className="h-3.5 w-3.5" />
        {room.memberCount}/5 在线
      </StatusPill>
      <StatusPill tone={status.tone}>
        {latencyMs > 0 ? `${Math.round(latencyMs)}ms` : status.title}
      </StatusPill>
      <Button variant="secondary" className="h-9 whitespace-nowrap px-3.5" onClick={() => navigate("settings")}>
        <Settings2 className="h-4 w-4" />
        设置
      </Button>
    </div>
  );
};
