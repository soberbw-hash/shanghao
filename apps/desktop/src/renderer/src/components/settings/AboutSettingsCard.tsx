import { useEffect, useState } from "react";
import { Coffee, ExternalLink, Github, Globe2, History, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import type { RuntimeInfo, UpdateCheckResult, UpdateStatus } from "@private-voice/shared";

import brandMark from "../../assets/brand-mark.svg";
import donateQr from "../../assets/donate-qr.jpg";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { ReleaseDetailModal } from "../status/ReleaseDetailModal";
import { RELEASE_HISTORY, type ReleaseHistoryEntry } from "../status/releaseHistory";
import { SettingsSection } from "./SettingsSection";

const AUTHOR_URL = "https://github.com/soberbw-hash";
const PROJECT_URL = "https://github.com/soberbw-hash/shanghao";
const OFFICIAL_WEBSITE_URL = "https://shanghao-d3ga95tc8224e727a-1315451893.tcloudbaseapp.com/";

interface AboutSettingsCardProps {
  runtimeInfo?: RuntimeInfo;
  updateInfo?: UpdateCheckResult;
  updateStatus: UpdateStatus;
  onCheckUpdates: () => Promise<UpdateCheckResult>;
  onOpenReleases: () => Promise<void>;
}

const DonationDialog = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="donation-modal-backdrop modal-scrim"
          role="presentation"
          variants={reduceMotion ? reducedFadeVariants : overlayScrimVariants}
          initial="initial"
          animate="open"
          exit="closed"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.section
            className="donation-modal-panel modal-surface"
            role="dialog"
            aria-modal="true"
            aria-labelledby="donation-modal-title"
            variants={reduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
            initial="initial"
            animate="open"
            exit="closed"
          >
            <div className="donation-modal-heading">
              <div>
                <span className="donation-modal-kicker">支持开发</span>
                <h2 id="donation-modal-title">请作者喝杯咖啡</h2>
              </div>
              <DialogCloseButton label="关闭投喂窗口" onClick={onClose} />
            </div>
            <p>如果上号让你和朋友相处得更轻松，可以请我补充一点开发续航。</p>
            <div className="donation-qr-shell">
              <img src={donateQr} alt="投喂作者的收款二维码" draggable={false} />
            </div>
            <div className="donation-modal-actions">
              <span>微信扫码，心意随缘</span>
              <Button variant="secondary" onClick={onClose}>
                完成
              </Button>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};

export const AboutSettingsCard = ({
  runtimeInfo,
  updateInfo,
  updateStatus,
  onCheckUpdates,
  onOpenReleases,
}: AboutSettingsCardProps) => {
  const [isDonationOpen, setIsDonationOpen] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState<ReleaseHistoryEntry>();
  const isChecking = updateStatus.phase === "checking";
  const currentVersion = runtimeInfo?.version ?? "读取中…";
  const updateMessage = isChecking
    ? updateStatus.message
    : updateInfo?.message || updateStatus.message || "点击检查是否有新版本";
  const updateTone =
    updateStatus.phase === "error" ? "error" : updateInfo?.hasUpdate ? "available" : "current";

  const openExternal = (url: string) => void window.desktopApi.app.openExternal(url);

  return (
    <div className="about-settings-page">
      <SettingsSection title="关于上号" description="版本、更新与项目信息都放在这里。">
        <section className="about-product-card" aria-label="上号版本信息">
          <img className="about-product-mark" src={brandMark} alt="上号" draggable={false} />
          <div className="about-product-copy">
            <div className="about-product-title-row">
              <div>
                <h4>上号</h4>
              </div>
              <span className="about-version-chip">版本 {currentVersion}</span>
            </div>
            <div className="about-update-row">
              <span className="about-update-status" data-tone={updateTone}>
                <i aria-hidden="true" />
                {updateMessage}
              </span>
              <div className="about-action-row">
                <Button
                  variant="secondary"
                  disabled={isChecking}
                  onClick={() => void onCheckUpdates()}
                >
                  <RefreshCw className={`size-4 ${isChecking ? "animate-spin" : ""}`} />
                  {isChecking ? "正在检查" : "检查更新"}
                </Button>
                <Button variant="ghost" onClick={() => void onOpenReleases()}>
                  <ExternalLink className="size-4" />
                  发布页面
                </Button>
              </div>
            </div>
          </div>
        </section>

        <div className="about-info-grid">
          <article className="about-info-card">
            <span className="about-info-icon about-info-icon--project">
              <Github aria-hidden="true" />
            </span>
            <div className="about-info-copy">
              <h4>作者与项目</h4>
              <p>查看作者主页、项目源码和最新开发动态。</p>
            </div>
            <div className="about-card-actions">
              <Button variant="secondary" onClick={() => openExternal(AUTHOR_URL)}>
                作者主页
              </Button>
              <Button variant="ghost" onClick={() => openExternal(PROJECT_URL)}>
                项目主页
                <ExternalLink className="size-3.5" />
              </Button>
              <Button variant="ghost" onClick={() => openExternal(OFFICIAL_WEBSITE_URL)}>
                <Globe2 className="size-3.5" />
                官方网站
              </Button>
            </div>
          </article>

          <article className="about-info-card about-info-card--support">
            <span className="about-info-icon about-info-icon--support">
              <Coffee aria-hidden="true" />
            </span>
            <div className="about-info-copy">
              <h4>支持开发</h4>
              <p>喜欢上号的话，可以请作者喝杯咖啡。</p>
            </div>
            <div className="about-card-actions">
              <Button variant="secondary" onClick={() => setIsDonationOpen(true)}>
                <Coffee className="size-4" />
                投喂作者
              </Button>
            </div>
          </article>
        </div>

        <details className="about-release-history">
          <summary>
            <span className="about-release-summary-icon">
              <History aria-hidden="true" />
            </span>
            <span>
              <strong>历史版本</strong>
              <small>需要时再展开，不打扰日常设置</small>
            </span>
            <span className="about-release-count">{RELEASE_HISTORY.length} 个版本</span>
          </summary>
          <div className="about-release-list" aria-label="完整版本更新记录">
            {RELEASE_HISTORY.map((release, index) => (
              <button
                key={release.version}
                type="button"
                className="about-release-item"
                aria-haspopup="dialog"
                onClick={() => setSelectedRelease(release)}
              >
                <span>
                  <strong>上号 {release.version}</strong>
                  {index === 0 ? <em>最新</em> : null}
                </span>
                <span className="about-release-item-copy">{release.title}</span>
                <time>{release.date}</time>
              </button>
            ))}
          </div>
        </details>
      </SettingsSection>

      <DonationDialog isOpen={isDonationOpen} onClose={() => setIsDonationOpen(false)} />
      <ReleaseDetailModal release={selectedRelease} onClose={() => setSelectedRelease(undefined)} />
    </div>
  );
};
