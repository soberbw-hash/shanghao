import { Settings2 } from "lucide-react";

import { TailscaleState, type ConnectionMode } from "@private-voice/shared";
import { Button, StatusPill } from "@private-voice/ui";

import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";

const modeLabelMap: Record<ConnectionMode, string> = {
  direct_host: "房主直连",
  tailscale: "Tailscale",
  relay: "云中继",
};

export const TopStatusBar = () => {
  const navigate = useAppStore((state) => state.navigate);
  const connectionMode = useRoomStore((state) => state.room.connectionMode);
  const tailscaleStatus = useSettingsStore((state) => state.tailscaleStatus);

  const shouldShowTailscale =
    connectionMode === "tailscale" || tailscaleStatus?.state === TailscaleState.Connected;
  const tailscaleTone =
    tailscaleStatus?.state === TailscaleState.Connected
      ? "success"
      : tailscaleStatus?.state === TailscaleState.NotInstalled
        ? "warning"
        : "neutral";

  return (
    <div className="flex items-center justify-end gap-1.5">
      <StatusPill tone="neutral">{modeLabelMap[connectionMode]}</StatusPill>
      {shouldShowTailscale ? (
        <StatusPill tone={tailscaleTone}>
          {tailscaleStatus?.state === TailscaleState.Connected ? "Tailscale 已连接" : "Tailscale"}
        </StatusPill>
      ) : null}
      <Button variant="secondary" className="h-9 px-3.5" onClick={() => navigate("settings")}>
        <Settings2 className="h-4 w-4" />
        设置
      </Button>
    </div>
  );
};
