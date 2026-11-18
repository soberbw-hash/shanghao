export function screenShareErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message === "room_not_connected")
    return "房间连接未就绪，请重新进入房间后再分享。";
  if (error instanceof Error && error.name === "NotFoundError")
    return "没有找到可分享的显示器或窗口。";
  if (error instanceof Error && error.name === "NotReadableError")
    return "Windows 无法读取所选画面，请重新选择显示器后再试。";
  return "屏幕分享未能启动，请重试；错误详情已写入诊断日志。";
}
