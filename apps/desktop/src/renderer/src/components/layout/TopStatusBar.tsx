import { Settings2 } from "lucide-react";

import { type ConnectionMode, APP_NAME, TailscaleState } from "@private-voice/shared";
import { Button, StatusPill } from "@private-voice/ui";

import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";
import { BrandMark } from "../brand/BrandMark";

const modeLabelMap: Record<ConnectionMode, string> = {
  direct_host: "房主直连",
  tailscale: "Tailscale",
  relay: "云中继",
};

const getConnectionLabel = (state: string, memberCount: number) => {
  if (state === "waiting_peer" || (state === "connected" && memberCount <= 1)) {
    return { label: "等待加入", tone: "neutral" as const };
  }
  if (state === "connected") {
    return { label: "已连接", tone: "success" as const };
  }
  if (state === "reconnecting") {
    return { label: "重连中", tone: "warning" as const };
  }
  if (state === "failed") {
    return { label: "连接失败", tone: "danger" as const };
  }
  if (state === "starting_host") {
    return { label: "正在开房", tone: "warning" as const };
  }
  if (state === "joining" || state === "handshaking") {
    return { label: "正在加入", tone: "warning" as const };
  }
  return { label: "待命", tone: "neutral" as const };
};

export const TopStatusBar = () => {
  const navigate = useAppStore((state) => state.navigate);
  const connectionState = useRoomStore((state) => state.room.connectionState);
  const memberCount = useRoomStore((state) => state.room.memberCount);
  const connectionMode = useRoomStore((state) => state.room.connectionMode);
  const tailscaleStatus = useSettingsStore((state) => state.tailscaleStatus);

  const roomStatus = getConnectionLabel(connectionState, memberCount);
  const shouldShowTailscale =
    connectionMode === "tailscale" || tailscaleStatus?.state === TailscaleState.Connected;
  const tailscaleTone =
    tailscaleStatus?.state === TailscaleState.Connected
      ? "success"
      : tailscaleStatus?.state === TailscaleState.NotInstalled
        ? "warning"
        : "neutral";

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <BrandMark size="sm" />
        <div className="min-w-0">
          <div className="truncate text-[17px] font-semibold text-[#111827]">{APP_NAME}</div>
          <div className="truncate text-xs text-[#667085]">打开就能进语音</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone="neutral">{modeLabelMap[connectionMode]}</StatusPill>
        <StatusPill tone={roomStatus.tone}>{roomStatus.label}</StatusPill>
        {shouldShowTailscale ? (
          <StatusPill tone={tailscaleTone}>
            {tailscaleStatus?.state === TailscaleState.Connected
              ? "Tailscale 已连接"
              : "Tailscale"}
          </StatusPill>
        ) : null}
        <Button variant="secondary" className="h-10 px-3" onClick={() => navigate("settings")}>
          <Settings2 className="h-4 w-4" />
          设置
        </Button>
      </div>
    </div>
  );
};
