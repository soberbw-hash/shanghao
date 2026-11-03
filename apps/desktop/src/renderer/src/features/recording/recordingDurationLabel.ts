export const recordingDurationLabel = (seconds: number | null | undefined) => {
  if (seconds === undefined) return "时长读取中";
  if (seconds === null) return "时长未知";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return `时长 ${hours ? `${hours}时` : ""}${minutes}分${total % 60}秒`;
};
