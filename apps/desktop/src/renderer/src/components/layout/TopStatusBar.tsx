import { Settings2 } from "lucide-react";

import { Button, StatusPill } from "@private-voice/ui";
import { APP_NAME, APP_SLOGAN, RoomConnectionState, TailscaleState } from "@private-voice/shared";

import { BrandMark } from "../brand/BrandMark";
import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";
import { getRoomConnectionLabel, getTailscaleStateLabel } from "../../utils/labels";

export const TopStatusBar = () => {
  const navigate = useAppStore((state) => state.navigate);
  const currentPage = useAppStore((state) => state.currentPage);
  const roomName = useRoomStore((state) => state.room.roomName);
  const connectionState = useRoomStore((state) => state.room.connectionState);
  const tailscaleStatus = useSettingsStore((state) => state.tailscaleStatus);

  const title = currentPage === "room" ? roomName : APP_NAME;
  const subtitle = currentPage === "room" ? APP_SLOGAN : "固定好友，打开就上号";
  const tailscaleTone =
    tailscaleStatus?.state === TailscaleState.Connected ? "success" : "warning";

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <BrandMark size="md" />
        <div className="min-w-0">
          <div className="truncate text-[18px] font-semibold text-[#111827]">{title}</div>
          <div className="truncate text-[13px] text-[#667085]">{subtitle}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone={connectionState === RoomConnectionState.Connected ? "success" : "accent"}>
          {getRoomConnectionLabel(connectionState)}
        </StatusPill>
        <StatusPill tone={tailscaleTone}>
          {tailscaleStatus?.state === TailscaleState.Connected
            ? "Tailscale 已连接"
            : `Tailscale ${getTailscaleStateLabel(tailscaleStatus?.state)}`}
        </StatusPill>
        <Button variant="secondary" onClick={() => navigate("settings")}>
          <Settings2 className="h-4 w-4" />
          设置
        </Button>
      </div>
    </div>
  );
};
