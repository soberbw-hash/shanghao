import { useEffect, useState } from "react";
import { Button } from "../base/Button";
import { AnimatedControlIcon } from "../icons/AnimatedControlIcon";

export const RecordingButton = ({
  isRecording,
  automatic,
  deadline,
  saving,
  onClick,
  disabled,
}: {
  isRecording: boolean;
  automatic?: boolean;
  deadline?: number;
  saving?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) => {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!deadline) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deadline]);
  const seconds = Math.max(0, Math.ceil(((deadline ?? now) - now) / 1000));
  const label = saving
    ? "正在保存"
    : isRecording && deadline
      ? `独处 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} 后保存`
      : isRecording
        ? automatic
          ? "自动录音中"
          : "录音中"
        : "录音";
  return (
    <Button
      variant={isRecording ? "danger" : "secondary"}
      data-icon-motion="record"
      className={`voice-action-button-with-text recording-button ${isRecording ? "is-recording bg-[#FFF0F0] text-[#FF5A5A] border-[rgba(255,90,90,0.25)]" : ""}`}
      data-ui-sound="handled"
      onClick={onClick}
      disabled={disabled || saving}
    >
      <AnimatedControlIcon name="record" active={isRecording} className="h-4 w-4" />
      <span className="voice-action-label">{label}</span>
      {isRecording && <span className="h-1.5 w-1.5 rounded-full bg-[#FF5A5A] animate-pulse" />}
    </Button>
  );
};
