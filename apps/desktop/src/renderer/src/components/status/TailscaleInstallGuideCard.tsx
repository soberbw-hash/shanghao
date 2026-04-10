import { Button } from "../base/Button";
import { SectionCard } from "../layout/SectionCard";

export const TailscaleInstallGuideCard = () => (
  <SectionCard
    title="Tailscale 设置"
    description="先安装 Tailscale 并登录到你的 tailnet，然后重新打开上号。"
  >
    <Button variant="secondary" onClick={() => void window.desktopApi.tailscale.openInstallGuide()}>
      打开 Tailscale 下载页
    </Button>
  </SectionCard>
);
