import { cn } from "@private-voice/ui";

import { ToggleButton } from "../base/ToggleButton";
import { AnimatedControlIcon } from "../icons/AnimatedControlIcon";

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
    data-icon-motion="mic"
    data-ui-sound="handled"
    onClick={onClick}
  >
    <AnimatedControlIcon name="mic" muted={isMuted} active={!isMuted} className="h-4 w-4" />
    <span className="voice-action-label">{isMuted ? "已静音" : "麦克风"}</span>
  </ToggleButton>
);
