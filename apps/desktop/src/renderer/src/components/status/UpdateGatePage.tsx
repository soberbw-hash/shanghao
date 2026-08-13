import { useState } from "react";
import { Download, RefreshCcw, AlertCircle, FileText } from "lucide-react";

import brandMarkUrl from "../../assets/brand-mark.svg";
import { Button } from "../base/Button";
import { useSettingsStore } from "../../store/settingsStore";
import { useAppStore } from "../../store/appStore";
import { ReleaseDetailModal } from "./ReleaseDetailModal";
import { getReleaseHistoryEntry } from "./releaseHistory";

export const UpdateGatePage = () => {
  const [isReleaseNotesOpen, setIsReleaseNotesOpen] = useState(false);
  const updateInfo = useSettingsStore((state) => state.updateInfo);
  const updateStatus = useSettingsStore((state) => state.updateStatus);
  const downloadUpdate = useSettingsStore((state) => state.downloadUpdate);
  const checkUpdates = useSettingsStore((state) => state.checkUpdates);
  const requiredUpdate = useAppStore((state) => state.requiredUpdate);

  const latestVersion =
    requiredUpdate?.requiredVersion ??
    updateInfo?.latestVersion ??
    updateStatus.latestVersion ??
    "";
  const isForced = Boolean(requiredUpdate || updateInfo?.forceUpdate || updateStatus.forceUpdate);
  const isDownloading = updateStatus.phase === "downloading";
  const isInstalling = updateStatus.phase === "installing";
  const isError = updateStatus.phase === "error";

  return (
    <div className="update-gate-page">
      <div className="update-gate-card">
        <div className="flex justify-center">
          <img
            src={brandMarkUrl}
            alt="上号"
            draggable={false}
            className="h-14 w-14 object-contain"
          />
        </div>

        <div className="mt-5 text-center text-xs font-semibold tracking-[0.18em] text-[#7B8798]">
          {isInstalling
            ? "正在安装"
            : isDownloading
              ? "正在更新"
              : isForced
                ? "需要更新"
                : "发现新版"}
        </div>
        <h2 className="mt-2 text-center text-[28px] font-[740] tracking-[-0.04em] text-[#172033]">
          上号 {latestVersion}
        </h2>
        <p className="mt-2 text-center text-sm leading-6 text-[#44546A]">
          {isInstalling
            ? "安装完成后会自动重新打开。"
            : isDownloading
              ? "下载完成后会自动安装并重启。"
              : isForced
                ? "更新后才能继续进入频道。"
                : "新版已经准备好，点击更新后会自动安装并重新打开。"}
        </p>
        {requiredUpdate ? (
          <div className="mt-4 rounded-2xl border border-[rgba(174,199,226,0.64)] bg-white/65 px-4 py-3 text-sm leading-6 text-[#44546A]">
            <strong className="block text-[#26364d]">需要更新上号</strong>
            为了避免不同版本之间出现语音、聊天和房间状态错乱，当前版本已经不能进入频道。
            <span className="mt-2 block tabular-nums">
              当前版本：{requiredUpdate.currentVersion} · 需要版本：{requiredUpdate.requiredVersion}
            </span>
          </div>
        ) : null}

        {isDownloading ? (
          <div className="mt-6">
            <div className="mb-2 flex justify-between text-xs text-[#44546A]">
              <span>{updateStatus.message}</span>
              <span>{Math.round(updateStatus.percent ?? 0)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#edf2f8]">
              <div
                className="h-full origin-left rounded-full bg-[#4DA3FF] transition-transform duration-300"
                style={{
                  transform: `scaleX(${Math.max(0, Math.min(1, (updateStatus.percent ?? 0) / 100))})`,
                }}
              />
            </div>
          </div>
        ) : null}

        {isInstalling ? (
          <div className="mt-6 flex justify-center">
            <div className="flex items-center gap-2 text-sm text-[#44546A]">
              <RefreshCcw className="h-4 w-4 animate-spin" />
              正在安装…
            </div>
          </div>
        ) : isError ? (
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-center gap-2 text-sm text-[#FF5A5A]">
              <AlertCircle className="h-4 w-4" />
              更新失败，请重试
            </div>
            <Button isFullWidth onClick={() => void checkUpdates()}>
              <RefreshCcw className="h-4 w-4" />
              重试
            </Button>
          </div>
        ) : (
          <div className="mt-6 grid gap-2">
            <Button isFullWidth disabled={isDownloading} onClick={() => void downloadUpdate()}>
              <Download className="h-4 w-4" />
              {isDownloading ? "正在更新…" : "立即更新"}
            </Button>
            <Button isFullWidth variant="secondary" onClick={() => setIsReleaseNotesOpen(true)}>
              <FileText className="h-4 w-4" />
              查看更新内容
            </Button>
          </div>
        )}
      </div>
      <ReleaseDetailModal
        release={isReleaseNotesOpen ? getReleaseHistoryEntry(latestVersion) : undefined}
        onClose={() => setIsReleaseNotesOpen(false)}
      />
    </div>
  );
};
