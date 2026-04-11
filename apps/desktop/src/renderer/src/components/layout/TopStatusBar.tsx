import { Settings2 } from "lucide-react";

import { Button, StatusPill } from "@private-voice/ui";
import { APP_NAME, APP_SLOGAN, TailscaleState, type ConnectionMode } from "@private-voice/shared";

import { BrandMark } from "../brand/BrandMark";
import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";
import { getPrimaryRoomStatus, getTailscaleStateLabel } from "../../utils/labels";

const modeLabelMap: Record<ConnectionMode, string> = {
  direct_host: "公网直连",
  tailscale: "Tailscale",
  relay: "云中继",
};

export const TopStatusBar = () => {
  const navigate = useAppStore((state) => state.navigate);
  const currentPage = useAppStore((state) => state.currentPage);
  const roomName = useRoomStore((state) => state.room.roomName);
  const connectionState = useRoomStore((state) => state.room.connectionState);
  const memberCount = useRoomStore((state) => state.room.memberCount);
  const connectionMode = useRoomStore((state) => state.room.connectionMode);
  const hostSession = useRoomStore((state) => state.hostSession);
  const tailscaleStatus = useSettingsStore((state) => state.tailscaleStatus);

  const roomStatus = getPrimaryRoomStatus({
    connectionState,
    memberCount,
    hasHostSession: Boolean(hostSession),
  });
  const subtitle = currentPage === "room" ? roomName : APP_SLOGAN;
  const tailscaleTone =
    tailscaleStatus?.state === TailscaleState.Connected
      ? "success"
      : tailscaleStatus?.state === TailscaleState.NotInstalled
        ? "warning"
        : "neutral";

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <BrandMark size="md" />
        <div className="min-w-0">
          <div className="truncate text-[17px] font-semibold text-[#111827]">{APP_NAME}</div>
          <div className="truncate text-[13px] text-[#667085]">{subtitle}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone="neutral">{modeLabelMap[connectionMode]}</StatusPill>
        <StatusPill tone={roomStatus.tone}>{roomStatus.label}</StatusPill>
        <StatusPill tone={tailscaleTone}>
          {tailscaleStatus?.state === TailscaleState.Connected
            ? "Tailscale 已连接"
            : `Tailscale ${getTailscaleStateLabel(tailscaleStatus?.state)}`}
        </StatusPill>
        <Button variant="secondary" className="h-10 px-3" onClick={() => navigate("settings")}>
          <Settings2 className="h-4 w-4" />
          设置
        </Button>
      </div>
    </div>
  );
};
