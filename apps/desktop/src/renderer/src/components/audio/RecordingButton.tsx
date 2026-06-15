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
    className={`voice-action-button whitespace-nowrap ${isRecording ? "bg-[#fef2f2] text-[#dc2626] border-[#fecaca]" : ""}`}
    onClick={onClick}
    disabled={disabled}
    title={isRecording ? "停止录音" : "开始录音"}
    aria-label={isRecording ? "停止录音" : "开始录音"}
  >
    {isRecording ? <Square className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
    <span className="voice-action-label">{isRecording ? "录音中" : "录音"}</span>
  </Button>
);
