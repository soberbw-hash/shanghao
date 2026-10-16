const phoneUnavailable = "手机麦克风尚未开始传输，请扫码并点击开始传输。";

export const microphoneErrorMessage = (error: unknown): string | undefined => {
  if (!(error instanceof Error)) return undefined;
  switch (error.name) {
    case "AudioCaptureTimeoutError":
      return "麦克风没有响应。请先恢复 Windows 音频或 RØDE Connect，再重新打开上号。";
    case "NotAllowedError":
      return "麦克风访问未获允许，请检查 Windows 的麦克风权限。";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "没有找到所选麦克风，请重新选择输入设备。";
    case "NotReadableError":
    case "TrackStartError":
      return "麦克风暂时无法读取，请重新选择输入设备。使用 RØDE Connect 时请选择 Stream Input。";
    case "OverconstrainedError":
      return "所选麦克风不支持当前采集设置，请重新选择输入设备。";
    default:
      return error.message === phoneUnavailable ? phoneUnavailable : undefined;
  }
};

// Preserve a local capture failure across the private-room error translation.
// Unknown device/DSP errors stay generic here; details belong in diagnostics.
export class MicrophoneAcquisitionError extends Error {
  constructor(cause: unknown) {
    super(microphoneErrorMessage(cause) ?? "麦克风启动失败，请检查声音设备后重试。", {
      cause,
    });
    this.name = "MicrophoneAcquisitionError";
  }
}
