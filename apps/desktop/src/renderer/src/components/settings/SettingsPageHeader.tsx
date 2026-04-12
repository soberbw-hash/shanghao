import { ArrowLeft } from "lucide-react";

import { Button } from "../base/Button";

export const SettingsPageHeader = ({
  onBack,
}: {
  onBack: () => void;
}) => (
  <div className="flex items-center justify-between gap-4">
    <div>
      <div className="text-[24px] font-semibold text-[#111827]">设置</div>
      <p className="text-sm text-[#667085]">资料、音频、连接和诊断都在这里。</p>
    </div>
    <Button variant="secondary" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" />
      返回
    </Button>
  </div>
);
