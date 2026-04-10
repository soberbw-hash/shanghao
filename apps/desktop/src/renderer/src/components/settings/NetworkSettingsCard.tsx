import type { TailscaleStatus } from "@private-voice/shared";

import { Button } from "../base/Button";
import { SettingsSection } from "./SettingsSection";

export const NetworkSettingsCard = ({
  tailscaleStatus,
  onRefresh,
}: {
  tailscaleStatus?: TailscaleStatus;
  onRefresh: () => void;
}) => (
  <SettingsSection title="网络与 Tailscale" description="固定好友的小房间优先走本地和 tailnet 连接。">
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-white/8 bg-white/[0.03] p-4">
      <div>
        <div className="text-sm font-medium text-white">{tailscaleStatus?.message}</div>
        <div className="mt-1 text-sm text-white/45">
          {tailscaleStatus?.ip ? `当前地址：${tailscaleStatus.ip}` : "暂未检测到 Tailscale 地址。"}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={onRefresh}>
          重新检测
        </Button>
        <Button variant="secondary" onClick={() => void window.desktopApi.tailscale.openInstallGuide()}>
          打开下载页
        </Button>
      </div>
    </div>
  </SettingsSection>
);
