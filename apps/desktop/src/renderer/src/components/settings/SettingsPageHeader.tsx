import { ArrowLeft } from "lucide-react";

import { Button } from "../base/Button";

export const SettingsPageHeader = ({ onBack }: { onBack: () => void }) => (
  <div className="flex items-center justify-between gap-4">
    <div className="text-[24px] font-semibold tracking-[-0.025em] text-[#111827]">设置</div>
    <Button variant="secondary" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" />
      返回
    </Button>
  </div>
);
