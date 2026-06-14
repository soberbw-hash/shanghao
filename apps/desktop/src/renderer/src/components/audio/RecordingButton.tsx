import { Circle, Square } from "lucide-react";

import { Button } from "../base/Button";

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
    className="h-10 w-10 shrink-0 rounded-[13px] p-0"
    onClick={onClick}
    disabled={disabled}
    title={isRecording ? "停止录音" : "开始录音"}
    aria-label={isRecording ? "停止录音" : "开始录音"}
  >
    {isRecording ? <Square className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
  </Button>
);
