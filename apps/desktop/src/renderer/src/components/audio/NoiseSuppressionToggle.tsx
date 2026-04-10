import { Waves } from "lucide-react";

import { ToggleButton } from "../base/ToggleButton";

export const NoiseSuppressionToggle = ({
  isEnabled,
  onClick,
}: {
  isEnabled: boolean;
  onClick: () => void;
}) => (
  <ToggleButton isActive={isEnabled} onClick={onClick}>
    <Waves className="h-4 w-4" />
    基础降噪
  </ToggleButton>
);
