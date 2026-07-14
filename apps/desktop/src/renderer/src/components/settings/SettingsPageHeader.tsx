import { ArrowLeft } from "lucide-react";

import { Button } from "../base/Button";

export const SettingsPageHeader = ({ onBack }: { onBack: () => void }) => (
  <div className="settings-page-header flex items-end justify-between gap-4">
    <div>
      <div className="settings-page-eyebrow">SHANGHAO PREFERENCES</div>
      <div className="settings-page-title text-[24px] font-semibold tracking-[-0.025em] text-[#111827]">
        设置
      </div>
    </div>
    <Button className="settings-back-button" variant="secondary" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" />
      返回
    </Button>
  </div>
);
