import type { VoiceMemoryRecord } from "@private-voice/shared";
import { useState } from "react";
import { useSettingsStore } from "../../store/settingsStore";
import { Button } from "../base/Button";

/** Existing cloud replies can be reused when opting an old recording into assistance. */
export function CloudLocalAssistAction({ record }: { record: VoiceMemoryRecord }) {
  const settings = useSettingsStore((state) => state.settings);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState(false);
  if (
    !settings?.isAiCloudLocalAssistEnabled ||
    settings.aiTranscriptionProvider === "local" ||
    record.phase !== "ready" ||
    record.transcriptionAssist?.status === "completed" ||
    !["siliconflow-sensevoice-small", "custom-asr-api"].includes(
      record.transcriptionModel?.id ?? "",
    )
  )
    return null;
  const start = async () => {
    setStarting(true);
    setFailed(false);
    try {
      await window.desktopApi.ai.processRecording({
        recordingId: record.recordingId,
        filePath: record.filePath,
        roomId: record.roomId,
        manual: true,
        transcribe: true,
        organize: false,
        restartTranscription: false,
      });
    } catch {
      setFailed(true);
    } finally {
      setStarting(false);
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#718096]">
      <Button
        variant="secondary"
        className="min-h-8 px-3 text-xs"
        disabled={starting}
        onClick={() => void start()}
      >
        {starting ? "正在启动…" : "本地辅助校对"}
      </Button>
      {failed ? <span role="alert">未能启动，请稍后重试。</span> : null}
    </div>
  );
}
