import { useMemo } from "react";
import type { RecordingLibraryItem } from "@private-voice/shared";
import type { RecordingLibraryFilters } from "../../features/recording/recordingLibrarySearch";

export function RecordingLibraryFiltersControl({
  items,
  filters,
  onChange,
}: {
  items: RecordingLibraryItem[];
  filters: RecordingLibraryFilters;
  onChange: (next: RecordingLibraryFilters) => void;
}) {
  const rooms = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of items)
      if (item.roomId) names.set(item.roomId, item.roomName || "未命名房间");
    return [...names].map(([id, name]) => ({
      id,
      label:
        [...names.values()].filter((other) => other === name).length > 1
          ? `${name} · ${id.slice(0, 8)}`
          : name,
    }));
  }, [items]);
  const controlClass =
    "min-w-0 w-full rounded-lg border border-[#c8d5e3] bg-white px-2 py-1.5 text-xs text-[#344b63] focus-visible:outline-2 focus-visible:outline-[#2e7ed8]";
  return (
    <div className="mx-3 mb-3 grid grid-cols-2 gap-2 text-xs text-[#465d75]">
      <label>
        房间
        <select
          aria-label="筛选录音房间"
          className={controlClass}
          value={filters.roomId}
          onChange={(event) => onChange({ ...filters, roomId: event.target.value })}
        >
          <option value="">全部房间</option>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.label}
            </option>
          ))}
          <option value="unassigned">未记录房间</option>
        </select>
      </label>
      <label>
        转录状态
        <select
          aria-label="筛选转录状态"
          className={controlClass}
          value={filters.transcript}
          onChange={(event) =>
            onChange({
              ...filters,
              transcript: event.target.value as RecordingLibraryFilters["transcript"],
            })
          }
        >
          <option value="all">全部状态</option>
          <option value="has">已有文字</option>
          <option value="none">暂无可用文字</option>
          <option value="working">正在处理</option>
          <option value="failed">处理失败</option>
        </select>
      </label>
    </div>
  );
}
