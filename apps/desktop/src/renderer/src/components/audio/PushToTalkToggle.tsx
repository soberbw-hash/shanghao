import { Radio } from "lucide-react";

import { ToggleButton } from "../base/ToggleButton";

export const PushToTalkToggle = ({
  isEnabled,
  onClick,
}: {
  isEnabled: boolean;
  onClick: () => void;
}) => (
  <ToggleButton isActive={isEnabled} onClick={onClick}>
    <Radio className="h-4 w-4" />
    {isEnabled ? "按键说话" : "自由麦"}
  </ToggleButton>
);
