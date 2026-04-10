import type { RecordingResult } from "@private-voice/shared";

import { RecordingFileRow } from "./RecordingFileRow";

export const RecordingHistoryList = ({ items }: { items: RecordingResult[] }) =>
  items.length > 0 ? (
    <div className="space-y-3">
      <div className="text-sm font-medium text-white/70">最近导出的录音</div>
      {items.map((item) => (
        <RecordingFileRow key={`${item.filePath}-${item.durationMs}`} item={item} />
      ))}
    </div>
  ) : null;
