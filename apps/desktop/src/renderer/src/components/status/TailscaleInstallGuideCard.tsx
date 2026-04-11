import { Button } from "../base/Button";
import { SectionCard } from "../layout/SectionCard";

export const TailscaleInstallGuideCard = () => (
  <SectionCard
    title="先连上 Tailscale"
    description="固定好友使用时更稳。装好并登录同一个 tailnet 后，再回来开房。"
  >
    <Button variant="secondary" onClick={() => void window.desktopApi.tailscale.openInstallGuide()}>
      打开 Tailscale 下载页
    </Button>
  </SectionCard>
);
