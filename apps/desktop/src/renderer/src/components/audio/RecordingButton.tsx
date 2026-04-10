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
    onClick={onClick}
    disabled={disabled}
  >
    {isRecording ? <Square className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
    {isRecording ? "停止录音" : "开始录音"}
  </Button>
);
