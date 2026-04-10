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
  <SettingsSection title="Network & Tailscale" description="Private-room networking stays local-first and tailnet-friendly.">
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-white/8 bg-white/[0.03] p-4">
      <div>
        <div className="text-sm font-medium text-white">{tailscaleStatus?.message}</div>
        <div className="mt-1 text-sm text-white/45">
          {tailscaleStatus?.ip ? `Current address: ${tailscaleStatus.ip}` : "No Tailscale address detected yet."}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={onRefresh}>
          Detect again
        </Button>
        <Button variant="secondary" onClick={() => void window.desktopApi.tailscale.openInstallGuide()}>
          Open guide
        </Button>
      </div>
    </div>
  </SettingsSection>
);
