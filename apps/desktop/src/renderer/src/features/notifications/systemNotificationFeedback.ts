import { useAppStore } from "../../store/appStore";
import { desktopApi } from "../../utils/desktopApi";

/** One actionable notice per renderer session, without repeating chat contents. */
export const subscribeToSystemNotificationFailures = (): (() => void) => {
  let shown = false;
  return (
    desktopApi.app.onNotificationFailed?.((reason) => {
      if (shown) return;
      shown = true;
      useAppStore.getState().pushToast({
        tone: "warning",
        title: "系统通知未能送达",
        description:
          reason === "blocked"
            ? "Windows 已关闭通知。请开启系统通知，并检查上号通知和勿扰模式。"
            : "Windows 未能显示通知。请检查上号的通知权限和勿扰模式。",
        dedupeKey: "system-notification-failed",
        persistent: true,
        actionLabel: "打开通知设置",
        onAction: () => {
          void desktopApi.app.openSystemSettings("notifications");
        },
      });
    }) ?? (() => undefined)
  );
};
