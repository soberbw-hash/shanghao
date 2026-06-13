import { Copy, LoaderCircle, Settings2, Wifi, WifiOff } from "lucide-react";

import {
  RoomConnectionState,
  TailscaleState,
  type ConnectionMode,
} from "@private-voice/shared";
import { Button, StatusPill } from "@private-voice/ui";

import { useAppStore } from "../../store/appStore";
import { useRoomStore } from "../../store/roomStore";
import { useSettingsStore } from "../../store/settingsStore";
import { buildShareableInviteUrl } from "../../utils/invite";

const modeLabelMap: Record<ConnectionMode, string> = {
  cloudflare_tunnel: "临时公网",
  direct_host: "房主直连",
  tailscale: "Tailscale",
  relay: "云中继",
};

const statusCopy = (state: RoomConnectionState, memberCount: number) => {
  if (state === RoomConnectionState.Reconnecting || state === RoomConnectionState.Degraded) {
    return { title: "连接有波动，正在重连", detail: "语音链路会尽量保持", tone: "warning" as const };
  }
  if (state === RoomConnectionState.Failed || state === RoomConnectionState.Disconnected) {
    return { title: "连接失败", detail: "请重新加入房间", tone: "danger" as const };
  }
  if (
    state === RoomConnectionState.Joining ||
    state === RoomConnectionState.Handshaking ||
    state === RoomConnectionState.StartingHost
  ) {
    return { title: "正在连接", detail: "正在建立房间链路", tone: "neutral" as const };
  }
  if (state === RoomConnectionState.WaitingPeer) {
    return { title: "等待好友加入", detail: `${memberCount}/5 人`, tone: "success" as const };
  }
  if (state === RoomConnectionState.Connected) {
    return { title: "已连接", detail: `${memberCount}/5 人`, tone: "success" as const };
  }
  return { title: "准备上号", detail: "尚未连接", tone: "neutral" as const };
};

export const TopStatusBar = ({
  variant = "compact",
  onCopyInvite,
}: {
  variant?: "compact" | "room";
  onCopyInvite?: () => void;
}) => {
  const navigate = useAppStore((state) => state.navigate);
  const room = useRoomStore((state) => state.room);
  const hostSession = useRoomStore((state) => state.hostSession);
  const connectionMode = room.connectionMode;
  const tailscaleStatus = useSettingsStore((state) => state.tailscaleStatus);

  const shouldShowTailscale =
    connectionMode === "tailscale" || tailscaleStatus?.state === TailscaleState.Connected;
  const tailscaleTone =
    tailscaleStatus?.state === TailscaleState.Connected
      ? "success"
      : tailscaleStatus?.state === TailscaleState.NotInstalled
        ? "warning"
        : "neutral";

  if (variant === "room") {
    const status = statusCopy(room.connectionState, room.memberCount);
    const address = buildShareableInviteUrl(hostSession) || room.signalingUrl;
    const isBusy = room.connectionState === RoomConnectionState.Reconnecting ||
      room.connectionState === RoomConnectionState.Degraded ||
      room.connectionState === RoomConnectionState.Joining ||
      room.connectionState === RoomConnectionState.Handshaking;
    const shellTone =
      status.tone === "danger"
        ? "border-[#F2C6C6] bg-[#FFF7F7]"
        : status.tone === "warning"
          ? "border-[#F4D7A2] bg-[#FFFBF2]"
          : "border-[#DCE8F7] bg-gradient-to-r from-white to-[#F4F9FF]";

    return (
      <div className={`flex min-h-[78px] items-center gap-4 rounded-[20px] border px-4 py-3 shadow-[0_12px_30px_rgba(17,24,39,0.06)] ${shellTone}`}>
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
          <div className="min-w-0">
            <div className="text-base font-semibold text-[#111827]">{status.title}</div>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-[#667085]">
              <span>{modeLabelMap[connectionMode]}</span>
              <span>·</span>
              <span>{status.detail}</span>
              {address ? (
                <>
                  <span>·</span>
                  <span className="max-w-[320px] truncate">{address}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <StatusPill tone={status.tone}>{modeLabelMap[connectionMode]}</StatusPill>
        {address && onCopyInvite ? (
          <Button variant="secondary" className="h-9 whitespace-nowrap px-3.5" onClick={onCopyInvite}>
            <Copy className="h-4 w-4" />
            复制地址
          </Button>
        ) : null}
        <Button variant="secondary" className="h-9 whitespace-nowrap px-3.5" onClick={() => navigate("settings")}>
          <Settings2 className="h-4 w-4" />
          设置
        </Button>
      </div>
    );
  }

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
