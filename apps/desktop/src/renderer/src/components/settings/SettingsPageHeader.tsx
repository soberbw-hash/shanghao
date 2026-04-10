import { ArrowLeft } from "lucide-react";

import { Button } from "../base/Button";

export const SettingsPageHeader = ({
  onBack,
}: {
  onBack: () => void;
}) => (
  <div className="flex items-center justify-between gap-4">
    <div>
      <div className="text-[24px] font-semibold text-white">设置</div>
      <p className="text-sm text-white/55">把语音、快捷键和网络状态都收在这里。</p>
    </div>
    <Button variant="secondary" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" />
      返回
    </Button>
  </div>
);
