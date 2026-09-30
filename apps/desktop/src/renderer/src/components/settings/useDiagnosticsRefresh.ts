import { useEffect, useRef, useState } from "react";
import type { RelayStatusSnapshot, RuntimeHealthSnapshot } from "@private-voice/shared";

import { runtimeHealthCollector } from "../../features/diagnostics/runtimeHealthCollector";
import { useAppStore } from "../../store/appStore";

export const useDiagnosticsRefresh = (
  relayServerUrl: string | undefined,
  onRefreshWindows: () => Promise<void>,
) => {
  const pushToast = useAppStore((state) => state.pushToast);
  const busy = useRef(false);
  const [runtimeHealth, setRuntimeHealth] = useState<RuntimeHealthSnapshot | undefined>(() =>
    runtimeHealthCollector.snapshot(),
  );
  const [relay, setRelay] = useState<RelayStatusSnapshot>();
  const [isRefreshingHealth, setIsRefreshingHealth] = useState(false);
  const [isRefreshingWindows, setIsRefreshingWindows] = useState(false);
  const [checkFeedback, setCheckFeedback] = useState<string>();

  useEffect(() => {
    if (!relayServerUrl) {
      setRelay(undefined);
      return;
    }
    let cancelled = false;
    void window.desktopApi.diagnostics
      .testServer(relayServerUrl)
      .then((snapshot) => {
        if (!cancelled) setRelay(snapshot);
      })
      .catch(() => {
        if (!cancelled) setRelay(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [relayServerUrl]);

  useEffect(() => {
    const unsubscribe = runtimeHealthCollector.subscribe(setRuntimeHealth);
    const stopDetailed = runtimeHealthCollector.observeDetailed();
    return () => {
      stopDetailed();
      unsubscribe();
    };
  }, []);

  const refreshDiagnostics = () => {
    if (busy.current) return;
    busy.current = true;
    setIsRefreshingHealth(true);
    setIsRefreshingWindows(true);
    setCheckFeedback("正在检查连接、设备和系统权限…");
    void Promise.allSettled([
      runtimeHealthCollector.refresh(),
      relayServerUrl
        ? window.desktopApi.diagnostics
            .testServer(relayServerUrl)
            .then((snapshot) => setRelay(snapshot))
            .catch((error: unknown) => {
              setRelay(undefined);
              throw error;
            })
        : Promise.resolve(),
      onRefreshWindows(),
    ])
      .then((results) => {
        const failed = results.some((result) => result.status === "rejected");
        const message = failed ? "部分检查未完成，请稍后重试。" : "检查完成，状态已更新。";
        setCheckFeedback(`${message} ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`);
        pushToast({ tone: failed ? "warning" : "success", title: message });
      })
      .finally(() => {
        busy.current = false;
        setIsRefreshingHealth(false);
        setIsRefreshingWindows(false);
      });
  };

  const refreshWindowsPermissions = () => {
    if (busy.current) return;
    busy.current = true;
    setIsRefreshingWindows(true);
    setCheckFeedback("正在检查系统权限…");
    void onRefreshWindows()
      .then(() => {
        setCheckFeedback(
          `系统权限检查完成。 ${new Date().toLocaleTimeString("zh-CN", { hour12: false })}`,
        );
        pushToast({ tone: "success", title: "系统权限已重新检查" });
      })
      .catch(() => {
        setCheckFeedback("系统权限检查失败，请稍后重试。");
        pushToast({ tone: "danger", title: "系统权限检查失败" });
      })
      .finally(() => {
        busy.current = false;
        setIsRefreshingWindows(false);
      });
  };

  return {
    runtimeHealth,
    relay,
    isRefreshingHealth,
    isRefreshingWindows,
    checkFeedback,
    refreshDiagnostics,
    refreshWindowsPermissions,
  };
};
