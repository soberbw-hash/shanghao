export const RECORDING_CLIP_PRESETS = {
  short: { beforeMs: 10_000, afterMs: 5_000 },
  standard: { beforeMs: 20_000, afterMs: 8_000 },
  long: { beforeMs: 40_000, afterMs: 15_000 },
} as const;

export interface RecordingClipRequest {
  filePath: string;
  markerId: string;
  beforeMs: number;
  afterMs: number;
}
export interface RecordingClipResult {
  filePath: string;
  fileName: string;
  startMs: number;
  endMs: number;
  durationMs: number;
}
export const recordingClipWindow = (
  offsetMs: number,
  durationMs: number,
  beforeMs: number,
  afterMs: number,
): { startMs: number; endMs: number; durationMs: number } => {
  if (
    ![offsetMs, durationMs].every(Number.isSafeInteger) ||
    durationMs <= 0 ||
    offsetMs < 0 ||
    offsetMs > durationMs
  )
    throw new Error("clip_marker_out_of_range");
  if (
    ![beforeMs, afterMs].every(Number.isSafeInteger) ||
    beforeMs < 0 ||
    afterMs < 0 ||
    beforeMs + afterMs < 3_000 ||
    beforeMs + afterMs > 120_000
  )
    throw new Error("clip_invalid_window");
  const startMs = Math.max(0, offsetMs - beforeMs);
  const endMs = Math.min(durationMs, offsetMs + afterMs);
  if (endMs - startMs < 3_000) throw new Error("clip_too_short");
  return { startMs, endMs, durationMs: endMs - startMs };
};

export const recordingClipErrorMessage = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const reasons: Record<string, string> = {
    clip_invalid_request: "导出参数无效，请重新选择标记",
    clip_invalid_window: "片段时长须为 3–120 秒",
    clip_too_short: "录音边缘不足 3 秒，请增加截取范围",
    clip_marker_out_of_range: "标记超出录音长度，无法导出",
    clip_marker_missing: "找不到这个标记，请重新打开录音",
    clip_source_unreadable: "原录音找不到或无法读取",
    clip_component_missing: "导出组件缺失，请重新安装上号",
    clip_write_failed: "无法写入片段，请检查磁盘空间和文件夹权限",
    clip_export_failed: "录音无法解码，片段导出失败",
    clip_export_timeout: "导出超时，请稍后重试",
    clip_queue_full: "导出队列已满，请等待当前任务完成",
    clip_export_cancelled: "导出已取消",
  };
  return (
    Object.entries(reasons).find(([code]) => message.includes(code))?.[1] ??
    "片段导出失败，请稍后重试"
  );
};
