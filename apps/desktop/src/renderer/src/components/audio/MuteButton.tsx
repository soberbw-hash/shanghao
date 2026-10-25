import { cn } from "@private-voice/ui";

import { ToggleButton } from "../base/ToggleButton";
import { AnimatedControlIcon } from "../icons/AnimatedControlIcon";
import { MicrophoneLevelFill } from "./MicrophoneLevelFill";
import type { MicrophoneStatus } from "../../features/audio/microphoneStatus";

export const MuteButton = ({
  isMuted,
  onClick,
  className,
  showLevelFill = true,
  status,
}: {
  isMuted: boolean;
  onClick: () => void;
  className?: string;
  showLevelFill?: boolean;
  status?: MicrophoneStatus;
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
    title={status?.detail}
    aria-label={`${isMuted ? "取消静音" : "静音麦克风"}${status ? `。${status.detail}` : ""}`}
    onClick={onClick}
  >
    {showLevelFill ? <MicrophoneLevelFill muted={isMuted} /> : null}
    <AnimatedControlIcon name="mic" muted={isMuted} className="voice-primary-icon relative z-[1]" />
    <span className="voice-action-label relative z-[1] flex flex-col items-start leading-tight">
      <span>{isMuted ? "已静音" : "麦克风"}</span>
      {status && (status.tone === "warning" || !["active", "muted"].includes(status.capture)) ? (
        <small
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className={cn(
            "text-[11px] font-normal",
            status.tone === "warning" ? "text-[#936627]" : "text-[#64758a]",
          )}
        >
          {status.label}
        </small>
      ) : null}
    </span>
  </ToggleButton>
);
