import { Trash2 } from "lucide-react";
import { type RecordingResult } from "@private-voice/shared";

import { TimeBadge } from "../base/TimeBadge";
import { useRecordingStore } from "../../store/recordingStore";

export const RecordingFileRow = ({ item, index }: { item: RecordingResult; index: number }) => {
  const deleteRecording = useRecordingStore((state) => state.deleteRecording);

  return (
    <div className="flex items-center justify-between gap-3 rounded-[14px] border border-[#E7ECF2] bg-white px-4 py-3">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-[#111827]">{item.filePath}</div>
        <div className="text-xs text-[#667085]">{item.mimeType}</div>
      </div>
      <div className="flex items-center gap-2">
        <TimeBadge value={`${Math.round(item.durationMs / 1000)} 秒`} />
        <button
          type="button"
          onClick={() => deleteRecording(index)}
          className="rounded-[8px] p-1.5 text-[#9ca3af] hover:bg-[#fef2f2] hover:text-[#dc2626] transition-colors"
          title="删除录音"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};
