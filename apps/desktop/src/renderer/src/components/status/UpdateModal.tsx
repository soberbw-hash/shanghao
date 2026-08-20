import { Download, RefreshCcw } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { Button } from "../base/Button";
import { useSettingsStore } from "../../store/settingsStore";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  popoverSurfaceVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";

export const UpdateModal = () => {
  const shouldReduceMotion = useReducedMotion();
  const updateInfo = useSettingsStore((state) => state.updateInfo);
  const status = useSettingsStore((state) => state.updateStatus);
  const downloadUpdate = useSettingsStore((state) => state.downloadUpdate);
  const installUpdate = useSettingsStore((state) => state.installUpdate);
  const checkUpdates = useSettingsStore((state) => state.checkUpdates);

  const isVisible = Boolean(
    updateInfo?.hasUpdate ||
    status.phase === "downloading" ||
    status.phase === "downloaded" ||
    status.phase === "ready_to_restart",
  );

  const latestVersion = updateInfo?.latestVersion ?? status.latestVersion ?? "";
  const isForced = Boolean(updateInfo?.forceUpdate || status.forceUpdate);
  const isDownloading = status.phase === "downloading";

  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          key={isForced ? "forced-update" : "optional-update"}
          variants={shouldReduceMotion ? reducedFadeVariants : overlayScrimVariants}
          initial="initial"
          animate="open"
          exit="closed"
          className={`fixed z-[90] grid p-6 ${
            isForced
              ? "inset-0 place-items-center bg-[#edf4ff]/88"
              : "bottom-0 right-0 pointer-events-none place-items-end"
          }`}
        >
          <motion.div
            variants={
              shouldReduceMotion
                ? reducedFadeVariants
                : isForced
                  ? dialogSurfaceVariants
                  : popoverSurfaceVariants
            }
            initial="initial"
            animate="open"
            exit="closed"
            role={isForced ? "alertdialog" : "status"}
            aria-modal={isForced ? "true" : undefined}
            aria-labelledby="update-modal-title"
            className="modal-surface pointer-events-auto w-full max-w-[430px] rounded-[30px] p-6"
          >
            <div className="text-xs font-semibold tracking-[0.18em] text-[#7990ad]">
              {isForced ? "需要更新" : "发现新版"}
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
                <div className="h-2 overflow-hidden rounded-full bg-[#edf2f8]">
                  <div
                    className="h-full w-full origin-left rounded-full bg-[#4f7df7] transition-transform duration-300"
                    style={{
                      transform: `scaleX(${Math.max(0, Math.min(100, status.percent ?? 0)) / 100})`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex gap-3">
              {status.phase === "downloaded" || status.phase === "ready_to_restart" ? (
                <Button isFullWidth onClick={() => void installUpdate()}>
                  <RefreshCcw className="h-4 w-4" />
                  安装并重新打开
                </Button>
              ) : (
                <Button isFullWidth disabled={isDownloading} onClick={() => void downloadUpdate()}>
                  <Download className="h-4 w-4" />
                  {isDownloading ? "正在更新…" : "立即更新"}
                </Button>
              )}
              {status.phase === "error" ? (
                <Button variant="secondary" onClick={() => void checkUpdates()}>
                  重试
                </Button>
              ) : null}
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
