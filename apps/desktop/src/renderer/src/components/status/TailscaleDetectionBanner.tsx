import { TailscaleState, type TailscaleStatus } from "@private-voice/shared";

import { Button } from "../base/Button";
import { InlineBanner } from "../layout/InlineBanner";

export const TailscaleDetectionBanner = ({
  status,
}: {
  status?: TailscaleStatus;
}) => {
  if (!status || status.state === TailscaleState.Connected) {
    return null;
  }

  return (
    <InlineBanner tone="warning">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>{status.message}</span>
        <Button variant="secondary" onClick={() => void window.desktopApi.tailscale.openInstallGuide()}>
          打开下载页
        </Button>
      </div>
    </InlineBanner>
  );
};
