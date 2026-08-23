import { useCallback, useEffect } from "react";
import { Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { DetailedReleaseNotesViewer } from "./DetailedReleaseNotesViewer";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";
import { usePrefersReducedMotion as useReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { useSettingsStore } from "../../store/settingsStore";
import { getReleaseHistoryEntry } from "./releaseHistory";
import { DialogCloseButton } from "../base/DialogCloseButton";

export const ReleaseNotesModal = () => {
  const shouldReduceMotion = useReducedMotion();
  const settings = useSettingsStore((state) => state.settings);
  const runtimeInfo = useSettingsStore((state) => state.runtimeInfo);
  const saveSettings = useSettingsStore((state) => state.saveSettings);

  const version = runtimeInfo?.version ?? "";
  const release = getReleaseHistoryEntry(version);
  const isVisible = Boolean(
    settings?.hasCompletedProfileSetup &&
    version &&
    version !== "0.0.0" &&
    settings.lastReleaseNotesVersionSeen !== version,
  );

  const dismiss = useCallback(() => {
    if (!version) return;
    void saveSettings({ lastReleaseNotesVersionSeen: version });
  }, [saveSettings, version]);

  useEffect(() => {
    if (!isVisible) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [dismiss, isVisible]);

  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          variants={shouldReduceMotion ? reducedFadeVariants : overlayScrimVariants}
          initial="initial"
          animate="open"
          exit="closed"
          className="fixed inset-0 z-[88] grid place-items-center bg-[#eaf3ff]/74 p-6 backdrop-blur-xl"
        >
          <motion.section
            variants={shouldReduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
            initial="initial"
            animate="open"
            exit="closed"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-notes-title"
            className="modal-surface w-full max-w-[560px] rounded-[32px] p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/72 px-3 py-1.5 text-xs font-semibold text-[#3974d8] shadow-sm">
                <Sparkles className="h-3.5 w-3.5" />
                欢迎回来
              </div>
              <DialogCloseButton label="稍后查看更新内容" onClick={dismiss} />
            </div>
            <h2
              id="release-notes-title"
              className="mt-4 text-[30px] font-[760] tracking-[-0.045em] text-[#142033]"
            >
              上号 {version} 更新好了
            </h2>
            <DetailedReleaseNotesViewer release={release} onComplete={dismiss} />
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
