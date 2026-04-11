import { type RecordingResult } from "@private-voice/shared";

import { TimeBadge } from "../base/TimeBadge";

export const RecordingFileRow = ({ item }: { item: RecordingResult }) => (
  <div className="flex items-center justify-between gap-3 rounded-[14px] border border-[#E7ECF2] bg-white px-4 py-3">
    <div className="min-w-0">
      <div className="truncate text-sm font-medium text-[#111827]">{item.filePath}</div>
      <div className="text-xs text-[#667085]">{item.mimeType}</div>
    </div>
    <TimeBadge value={`${Math.round(item.durationMs / 1000)} 秒`} />
  </div>
);
