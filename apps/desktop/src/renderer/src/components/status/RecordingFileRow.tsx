import { type RecordingResult } from "@private-voice/shared";

import { TimeBadge } from "../base/TimeBadge";

export const RecordingFileRow = ({ item }: { item: RecordingResult }) => (
  <div className="flex items-center justify-between gap-3 rounded-[14px] border border-white/8 bg-white/5 px-4 py-3">
    <div>
      <div className="text-sm font-medium text-white">{item.filePath}</div>
      <div className="text-xs text-white/45">{item.mimeType}</div>
    </div>
    <TimeBadge value={`${Math.round(item.durationMs / 1000)}s`} />
  </div>
);
