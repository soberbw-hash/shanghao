import { useCallback, useRef, useState } from "react";
import { Download, GripHorizontal, RefreshCcw } from "lucide-react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";

import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { useSettingsStore } from "../../store/settingsStore";
import { popoverSurfaceVariants, reducedFadeVariants } from "../../features/motion/motionPresets";
import { usePrefersReducedMotion as useReducedMotion } from "../../hooks/usePrefersReducedMotion";

export const UpdateModal = () => {
  const shouldReduceMotion = useReducedMotion();
  const dragControls = useDragControls();
  const dragBounds = useRef<HTMLDivElement>(null);
  const updateInfo = useSettingsStore((state) => state.updateInfo);
  const status = useSettingsStore((state) => state.updateStatus);
  const downloadUpdate = useSettingsStore((state) => state.downloadUpdate);
  const installUpdate = useSettingsStore((state) => state.installUpdate);
  const checkUpdates = useSettingsStore((state) => state.checkUpdates);
  const [dismissedVersion, setDismissedVersion] = useState(() =>
    window.localStorage.getItem("shanghao:dismissed-update-version"),
  );
  const [hiddenStatus, setHiddenStatus] = useState<typeof status>();

  const latestVersion = updateInfo?.latestVersion ?? status.latestVersion ?? "";
  const isForced = Boolean(updateInfo?.forceUpdate || status.forceUpdate);
  const isDownloading = status.phase === "downloading";
  const isDownloaded = status.phase === "downloaded" || status.phase === "ready_to_restart";

  const isVisible = Boolean(
    (updateInfo?.hasUpdate || isDownloading || isDownloaded) &&
    hiddenStatus !== status &&
    (isForced || isDownloaded || dismissedVersion !== latestVersion),
  );

  const dismissOptionalUpdate = useCallback(() => {
    if (isForced) return;
    setHiddenStatus(status);
    if (latestVersion) {
      window.localStorage.setItem("shanghao:dismissed-update-version", latestVersion);
      setDismissedVersion(latestVersion);
    }
    window.dispatchEvent(new Event("shanghao:update-dismissed"));
  }, [isForced, latestVersion, status]);

  return (
    <AnimatePresence>
      {isVisible ? (
        <div
          key={latestVersion}
          ref={dragBounds}
          className="update-modal-backdrop pointer-events-none fixed inset-0 z-[90] grid items-end justify-items-end p-4 pb-24"
        >
          <motion.div
            variants={shouldReduceMotion ? reducedFadeVariants : popoverSurfaceVariants}
            initial="initial"
            animate="open"
            exit="closed"
            drag
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={dragBounds}
            dragMomentum={false}
            dragElastic={0}
            role="region"
            aria-labelledby="update-modal-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") dismissOptionalUpdate();
            }}
            className="update-modal-surface modal-surface pointer-events-auto w-full min-w-0 max-w-[360px] rounded-[24px] p-5"
          >
            <div className="flex items-center justify-between gap-3">
              <div
                className="flex min-h-8 flex-1 touch-none select-none items-center gap-2 font-semibold text-[#546d89] cursor-grab active:cursor-grabbing"
                onPointerDown={(event) => dragControls.start(event)}
                title="拖动更新窗口"
              >
                <GripHorizontal className="h-4 w-4" aria-hidden="true" />
                <span className="text-xs">{isForced ? "需要更新" : "发现新版"}</span>
              </div>
              {!isForced ? (
                <DialogCloseButton label="稍后提醒" onClick={dismissOptionalUpdate} />
              ) : null}
            </div>
            <h2
              id="update-modal-title"
              className="mt-2 text-[26px] font-[740] tracking-[-0.04em] text-[#111827]"
            >
              上号 {latestVersion}
            </h2>
            <p className="mt-2 text-sm leading-6 text-[#667085]">
              {status.phase === "ready_to_restart" || status.phase === "downloaded"
                ? "新版已安全下载，确认后会安装并重新打开。"
                : isForced
                  ? "正在后台下载，完成后需要你确认安装。"
                  : "正在后台准备新版，下载完成前可以继续使用。"}
            </p>

            {isDownloading ? (
              <div className="mt-5">
                <div className="mb-2 flex justify-between text-xs text-[#667085]">
                  <span>{status.message}</span>
                  <span>{Math.round(status.percent ?? 0)}%</span>
                </div>
                <div
                  role="progressbar"
                  aria-label="更新下载进度"
                  aria-valuenow={Math.round(status.percent ?? 0)}
                  className="h-2 overflow-hidden rounded-full bg-[#edf2f8]"
                >
                  <div
                    className="h-full w-full origin-left rounded-full bg-[#4f7df7] transition-transform duration-300"
                    style={{
                      transform: `scaleX(${Math.max(0, Math.min(100, status.percent ?? 0)) / 100})`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex min-w-0 flex-wrap gap-3">
              {status.phase === "downloaded" || status.phase === "ready_to_restart" ? (
                <Button
                  className="min-w-[180px] flex-[1_1_180px]"
                  onClick={() => void installUpdate()}
                >
                  <RefreshCcw className="h-4 w-4" />
                  安装并重新打开
                </Button>
              ) : (
                <Button
                  className="min-w-[180px] flex-[1_1_180px]"
                  disabled={isDownloading}
                  onClick={() => void downloadUpdate()}
                >
                  <Download className="h-4 w-4" />
                  {isDownloading ? "正在更新…" : "立即更新"}
                </Button>
              )}
              {status.phase === "error" ? (
                <Button
                  className="shrink-0 whitespace-nowrap"
                  variant="secondary"
                  onClick={() => void checkUpdates()}
                >
                  重试
                </Button>
              ) : null}
              {!isForced && !isDownloading && !isDownloaded ? (
                <Button
                  className="shrink-0 whitespace-nowrap"
                  variant="secondary"
                  onClick={dismissOptionalUpdate}
                >
                  稍后提醒
                </Button>
              ) : null}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
};
