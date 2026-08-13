import { Sparkles } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { DetailedReleaseNotesViewer } from "./DetailedReleaseNotesViewer";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";
import { useSettingsStore } from "../../store/settingsStore";
import { getReleaseHistoryEntry } from "./releaseHistory";

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

  const dismiss = () => {
    if (!version) return;
    void saveSettings({ lastReleaseNotesVersionSeen: version });
  };

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
            <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/72 px-3 py-1.5 text-xs font-semibold text-[#3974d8] shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              欢迎回来
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
