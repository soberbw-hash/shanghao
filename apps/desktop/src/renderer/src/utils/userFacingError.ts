export type UserErrorContext =
  "audio" | "model" | "recording" | "screen-share" | "settings" | "general";

export interface UserFacingError {
  title: string;
  description: string;
}

export const technicalErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Keeps implementation details in diagnostics while giving the user a concrete next step. */
export const toUserFacingError = (
  error: unknown,
  context: UserErrorContext = "general",
): UserFacingError => {
  const message = technicalErrorMessage(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("enospc") || normalized.includes("disk full")) {
    return {
      title: "磁盘空间不足",
      description: "请清理磁盘空间或更换保存位置，然后重试。",
    };
  }
  if (
    normalized.includes("eacces") ||
    normalized.includes("eperm") ||
    normalized.includes("permission denied")
  ) {
    return {
      title: "没有写入权限",
      description: "请选择一个可以正常保存文件的位置，然后重试。",
    };
  }
  if (
    normalized.includes("notallowederror") ||
    normalized.includes("permission_denied") ||
    normalized.includes("not_allowed")
  ) {
    return context === "screen-share"
      ? {
          title: "Windows 没有允许屏幕捕获",
          description: "请允许上号共享画面，再重新读取可分享的窗口。",
        }
      : {
          title: "Windows 没有允许麦克风",
          description: "请在 Windows 麦克风隐私设置中允许上号，然后重试。",
        };
  }
  if (
    normalized.includes("cuda") ||
    normalized.includes("pytorch") ||
    normalized.includes("torch") ||
    normalized.includes("0xc0000135") ||
    normalized.includes("dll_missing") ||
    normalized.includes("runtime_not_ready") ||
    normalized.includes("runtime_unavailable")
  ) {
    return {
      title: "AI GPU 运行环境异常",
      description: "请到“AI 功能”找到当前模型并点击“修复组件”，详细原因已写入诊断日志。",
    };
  }
  if (
    normalized.includes("checksum") ||
    normalized.includes("integrity") ||
    normalized.includes("size_mismatch") ||
    normalized.includes("file_incomplete")
  ) {
    return {
      title: "模型文件校验未通过",
      description: "请在模型卡片上点击“重新校验并修复”，已完整下载的文件不会重复下载。",
    };
  }
  if (
    normalized.includes("fetch failed") ||
    normalized.includes("enetunreach") ||
    normalized.includes("econnrefused") ||
    normalized.includes("etimedout") ||
    normalized.includes("network")
  ) {
    return {
      title: context === "model" ? "模型下载连接中断" : "网络连接暂时不可用",
      description:
        context === "model"
          ? "请检查网络或代理后继续下载，已经下载的部分会保留。"
          : "请检查网络连接后重试。",
    };
  }
  if (context === "recording") {
    return {
      title: "录音操作没有完成",
      description: "录音仍保留在本机，请确认保存位置可用后重试。",
    };
  }
  if (context === "audio") {
    return {
      title: "声音设备没有准备好",
      description: "请确认设备仍然连接，换一个麦克风或扬声器后重试。",
    };
  }
  if (context === "screen-share") {
    return {
      title: "屏幕分享没有启动",
      description: "请重新读取画面来源；如果仍然失败，可换一个窗口再试。",
    };
  }
  if (context === "settings") {
    return {
      title: "设置没有保存",
      description: "当前修改仍显示在页面上，请稍后再次保存。",
    };
  }
  if (context === "model") {
    return {
      title: "模型操作没有完成",
      description: "请在当前模型卡片上重试，详细原因已写入诊断日志。",
    };
  }
  return { title: "操作没有完成", description: "请稍后重试，详细原因已写入诊断日志。" };
};
