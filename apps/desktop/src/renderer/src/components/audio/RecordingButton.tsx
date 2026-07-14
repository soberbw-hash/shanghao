import { Button } from "../base/Button";
import { AnimatedControlIcon } from "../icons/AnimatedControlIcon";

export const RecordingButton = ({
  isRecording,
  onClick,
  disabled,
}: {
  isRecording: boolean;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <Button
    variant={isRecording ? "danger" : "secondary"}
    data-icon-motion="record"
    className={`voice-action-button-with-text ${isRecording ? "bg-[#FFF0F0] text-[#FF5A5A] border-[rgba(255,90,90,0.25)]" : ""}`}
    data-ui-sound="handled"
    onClick={onClick}
    disabled={disabled}
  >
    <AnimatedControlIcon name="record" active={isRecording} className="h-4 w-4" />
    <span className="voice-action-label">{isRecording ? "录音中" : "录音"}</span>
    {isRecording && <span className="h-1.5 w-1.5 rounded-full bg-[#FF5A5A] animate-pulse" />}
  </Button>
);
