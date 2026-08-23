import type { AiModelStatus } from "@private-voice/shared";

export const modelProgressPercent = (model: AiModelStatus): number => {
  if (
    model.phase === "downloading" &&
    model.totalBytes > 0 &&
    model.downloadedBytes < model.totalBytes
  ) {
    return Math.min(99, Math.floor(model.progress));
  }
  return Math.round(model.progress);
};

export const modelPhaseLabel = (model: AiModelStatus): string => {
  const progress = modelProgressPercent(model);
  if (model.updateInProgress && model.phase === "error") return "新版下载失败 · 旧版仍可用";
  if (model.updateInProgress && model.phase === "paused") return "新版已暂停 · 旧版仍可用";
  if (model.updateInProgress && model.phase === "verifying")
    return "新版正在校验完整性 · 旧版仍可用";
  if (model.updateInProgress && model.phase === "preparing")
    return "新版正在准备 AI Runtime · 旧版仍可用";
  if (model.updateInProgress) return `新版处理中 ${progress}% · 旧版仍可用`;
  if (model.phase === "installed") return "已安装";
  if (model.phase === "queued") return "等待下载…";
  if (model.phase === "checking") return "正在读取文件清单…";
  if (model.phase === "downloading")
    return model.downloadedBytes >= model.totalBytes && model.totalBytes > 0
      ? "文件下载完成，准备校验…"
      : `下载中 ${progress}%`;
  if (model.phase === "verifying") return "正在校验完整性…";
  if (model.phase === "preparing") return "正在准备 AI Runtime…";
  if (model.phase === "paused") return `已暂停 ${progress}%`;
  if (model.phase === "error") {
    if (model.failureKind === "access") return "需要 Hugging Face 授权";
    if (model.failureKind === "integrity") return "完整性校验失败";
    if (model.failureKind === "network") return "网络下载中断";
    if (model.failureKind === "disk") return "磁盘空间不足";
    return "下载失败";
  }
  return "未安装";
};
