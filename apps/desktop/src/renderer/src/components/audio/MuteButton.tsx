import { cn } from "@private-voice/ui";

import { ToggleButton } from "../base/ToggleButton";
import { AnimatedControlIcon } from "../icons/AnimatedControlIcon";
import { MicrophoneLevelFill } from "./MicrophoneLevelFill";

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
      "voice-action-button-with-text voice-main-control microphone-meter-control",
      isMuted && "voice-main-control-primary",
      className,
    )}
    data-icon-motion="mic"
    data-ui-sound="handled"
    onClick={onClick}
  >
    <MicrophoneLevelFill muted={isMuted} />
    <AnimatedControlIcon name="mic" muted={isMuted} className="voice-primary-icon" />
    <span className="voice-action-label">{isMuted ? "已静音" : "麦克风"}</span>
  </ToggleButton>
);
