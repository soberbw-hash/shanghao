import { Mic, MicOff } from "lucide-react";
import { cn } from "@private-voice/ui";

import { ToggleButton } from "../base/ToggleButton";

export const MuteButton = ({
  isMuted,
  onClick,
  className,
}: {
  isMuted: boolean;
  onClick: () => void;
  className?: string;
}) => (
  <ToggleButton
    isActive={isMuted}
    className={cn(
      "voice-action-button-with-text voice-main-control",
      isMuted && "voice-main-control-primary",
      className,
    )}
    onClick={onClick}
  >
    {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    {isMuted ? "已静音" : "麦克风"}
  </ToggleButton>
);
