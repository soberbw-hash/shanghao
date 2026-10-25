import type { TranscriptView, TranscriptViewChoice } from "../../features/ai/transcriptView";

export function TranscriptSourceControl({
  view,
  options,
  choice,
  onChange,
}: {
  view: TranscriptView;
  options: TranscriptView[];
  choice: TranscriptViewChoice;
  onChange: (choice: TranscriptViewChoice) => void;
}) {
  return (
    <div className="transcript-source-control" role="note">
      <div className="flex flex-wrap items-center gap-2">
        <strong>文字稿</strong>
        <span title={view.model?.name}>{view.label}</span>
        {view.memberCoverage ? (
          <span title="姓名来自录制时绑定的成员音轨，未完成的成员仍在处理。">
            {view.memberCoverage}
          </span>
        ) : null}
        {view.reviewedCount ? (
          <span
            title={
              view.textUnchanged
                ? "与保存的本地原稿逐句比较，文字保持一致。"
                : "依据已保存的明确校对标记统计。"
            }
          >
            已校对 {view.reviewedCount} 句{view.textUnchanged ? " · 无文字修改" : ""}
          </span>
        ) : null}
        {view.estimated ? (
          <span
            title={
              view.timingLabel
                ? "按实际有声区间定位，尚非逐字强制对齐。"
                : "云端时间为估算位置，回听可能存在偏差。"
            }
          >
            {view.timingLabel ?? "时间估算"}
          </span>
        ) : null}
        {options.length > 1 ? (
          <select
            aria-label="转录文字版本"
            value={choice}
            onChange={(event) => onChange(event.target.value as TranscriptViewChoice)}
            className="rounded-lg border border-[#c7daf1] bg-white px-2 py-1"
          >
            <option value="auto">自动（优先融合稿）</option>
            {options.map((option) => (
              <option key={option.kind} value={option.kind}>
                {option.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}
