import { Link2, Settings2, Wifi } from "lucide-react";

import { Button, StatusPill } from "@private-voice/ui";
import { RoomConnectionState, TailscaleState } from "@private-voice/shared";

import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";

export const TopStatusBar = () => {
  const navigate = useAppStore((state) => state.navigate);
  const roomName = useRoomStore((state) => state.room.roomName);
  const connectionState = useRoomStore((state) => state.room.connectionState);
  const tailscaleStatus = useSettingsStore((state) => state.tailscaleStatus);

  const tailscaleTone =
    tailscaleStatus?.state === TailscaleState.Connected ? "success" : "warning";

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[24px] font-semibold text-white">{roomName}</div>
          <div className="text-sm text-white/45">Private voice space for your fixed crew</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusPill tone={connectionState === RoomConnectionState.Connected ? "success" : "accent"}>
          {connectionState.replaceAll("_", " ")}
        </StatusPill>
        <StatusPill tone={tailscaleTone}>
          {tailscaleStatus?.state === TailscaleState.Connected ? "Tailscale ready" : "Tailscale check"}
        </StatusPill>
        <Button variant="secondary" onClick={() => navigate("settings")}>
          <Settings2 className="h-4 w-4" />
          Settings
        </Button>
      </div>
    </div>
  );
};
