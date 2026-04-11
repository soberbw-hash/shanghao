import { Mic, MicOff } from "lucide-react";

import { ToggleButton } from "../base/ToggleButton";

export const MuteButton = ({
  isMuted,
  onClick,
}: {
  isMuted: boolean;
  onClick: () => void;
}) => (
  <ToggleButton isActive={isMuted} onClick={onClick}>
    {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    {isMuted ? "已静音" : "麦克风"}
  </ToggleButton>
);
