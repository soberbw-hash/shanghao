import { RotateCcw } from "lucide-react";

import { Button } from "../base/Button";

export const ResetSettingsButton = ({ onClick }: { onClick: () => void }) => (
  <Button variant="danger" onClick={onClick}>
    <RotateCcw className="h-4 w-4" />
    重置设置
  </Button>
);
