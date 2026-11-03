const periods: ReadonlyArray<readonly [number, string]> = [
  [5, "凌晨"],
  [9, "早上"],
  [11, "上午"],
  [13, "中午"],
  [18, "下午"],
  [24, "晚上"],
];

export function recordingTimePeriod(time: string): string {
  const hour = new Date(time).getHours();
  return periods.find(([until]) => hour < until)?.[1] ?? "";
}

export function automaticRecordingTitle(time: string, sequence: number): string {
  const period = recordingTimePeriod(time);
  return `${period}${period ? " · " : ""}语音 ${String(sequence).padStart(2, "0")}`;
}
