import { ArrowLeft } from "lucide-react";

import { Button } from "../base/Button";

export const SettingsPageHeader = ({
  onBack,
}: {
  onBack: () => void;
}) => (
  <div className="flex items-center justify-between gap-4">
    <div>
      <div className="text-[24px] font-semibold text-white">Settings</div>
      <p className="text-sm text-white/55">Keep the experience quiet, stable, and easy to read.</p>
    </div>
    <Button variant="secondary" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" />
      Back
    </Button>
  </div>
);
