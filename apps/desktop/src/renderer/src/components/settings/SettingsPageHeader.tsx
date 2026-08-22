import { ArrowLeft } from "lucide-react";

import { Button } from "../base/Button";

export const SettingsPageHeader = ({
  onBack,
  saveNotice,
}: {
  onBack: () => void;
  saveNotice: string;
}) => (
  <div className="settings-page-header flex items-center justify-between gap-4">
    <div>
      <div className="settings-page-eyebrow">SHANGHAO PREFERENCES</div>
      <div className="settings-page-title text-[24px] font-semibold tracking-[-0.025em] text-[#111827]">
        设置
      </div>
    </div>
    <div className="settings-page-header-actions">
      <div className="settings-save-notice" aria-live="polite">
        {saveNotice}
      </div>
      <Button className="settings-back-button" variant="secondary" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        返回
      </Button>
    </div>
  </div>
);
