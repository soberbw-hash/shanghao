import { Button } from "../base/Button";
import { SectionCard } from "../layout/SectionCard";

export const TailscaleInstallGuideCard = () => (
  <SectionCard
    title="Tailscale setup"
    description="Install Tailscale, sign into your private tailnet, then reopen Quiet Team."
  >
    <Button variant="secondary" onClick={() => void window.desktopApi.tailscale.openInstallGuide()}>
      Open Tailscale download
    </Button>
  </SectionCard>
);
