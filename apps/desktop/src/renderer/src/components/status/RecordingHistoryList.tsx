import type { RecordingResult } from "@private-voice/shared";

import { RecordingFileRow } from "./RecordingFileRow";

export const RecordingHistoryList = ({ items }: { items: RecordingResult[] }) => (
  <div className="space-y-3">
    {items.map((item) => (
      <RecordingFileRow key={`${item.filePath}-${item.durationMs}`} item={item} />
    ))}
  </div>
);
