import { APP_PROTOCOL_VERSION } from "@private-voice/shared";
import { compareVersions } from "./version-comparison";
import type { ErrorMessage, JoinChannelMessage } from "./protocol";

export function mediaClientCompatibilityError(
  message: JoinChannelMessage,
  requiredVersion?: string,
): ErrorMessage | undefined {
  const required = requiredVersion?.trim();
  if (
    required &&
    (!message.appVersion ||
      !Number.isFinite(compareVersions(message.appVersion, required)) ||
      compareVersions(message.appVersion, required) < 0)
  )
    return {
      type: "error",
      code: "CLIENT_UPDATE_REQUIRED",
      roomId: message.roomId,
      peerId: message.peerId,
      requiredVersion: required,
      currentVersion: message.appVersion || "未知",
      message: "当前版本已经不能进入频道，请更新后再试。",
    };
  if (message.protocolVersion !== APP_PROTOCOL_VERSION)
    return {
      type: "error",
      code: "version_mismatch",
      roomId: message.roomId,
      peerId: message.peerId,
      message: "当前版本太旧，请更新后再进入频道。",
    };
  return;
}
