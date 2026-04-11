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
  <SettingsSection title="网络与连接" description="优先使用 Tailscale，小圈子开黑更稳。">
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-[#E7ECF2] bg-[#F8FAFC] p-4">
      <div>
        <div className="text-sm font-medium text-[#111827]">{tailscaleStatus?.message}</div>
        <div className="mt-1 text-sm text-[#667085]">
          {tailscaleStatus?.ip ? `当前地址：${tailscaleStatus.ip}` : "还没有检测到可分享地址。"}
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
