import { useEffect } from "react";
import { FolderOpen } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";
import { usePrefersReducedMotion as useReducedMotion } from "../../hooks/usePrefersReducedMotion";

export const RecordingStopDialog = ({
  isOpen,
  isWorking,
  isChoosingDirectory,
  saveDirectory,
  onChangeDirectory,
  onContinue,
  onDiscard,
  onSave,
}: {
  isOpen: boolean;
  isWorking: boolean;
  isChoosingDirectory: boolean;
  saveDirectory: string;
  onChangeDirectory: () => void;
  onContinue: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) => {
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (!isOpen || isWorking) return;
    const continueOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onContinue();
    };
    document.addEventListener("keydown", continueOnEscape);
    return () => document.removeEventListener("keydown", continueOnEscape);
  }, [isOpen, isWorking, onContinue]);

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          variants={shouldReduceMotion ? reducedFadeVariants : overlayScrimVariants}
          initial="initial"
          animate="open"
          exit="closed"
          className="modal-scrim pointer-events-auto fixed inset-0 z-50 flex items-center justify-center px-6"
        >
          <motion.section
            variants={shouldReduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
            initial="initial"
            animate="open"
            exit="closed"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="recording-stop-title"
            aria-describedby="recording-save-location"
            className="modal-surface w-full max-w-[480px] rounded-[26px] p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <h2
                id="recording-stop-title"
                className="text-balance text-[22px] font-bold text-[#172235]"
              >
                确认要保存录音吗？
              </h2>
              <DialogCloseButton label="继续录音并关闭" disabled={isWorking} onClick={onContinue} />
            </div>
            <div className="mt-5 flex items-center gap-3 rounded-[14px] border border-[#dbe8f7] bg-white/68 px-3.5 py-3">
              <FolderOpen className="size-4 shrink-0 text-[#4d91e6]" aria-hidden="true" />
              <span id="recording-save-location" className="min-w-0 flex-1">
                <small className="block text-[10px] font-semibold text-[#8796aa]">保存位置</small>
                <strong
                  className="block truncate text-xs font-semibold text-[#52657d]"
                  title={saveDirectory}
                >
                  {saveDirectory}
                </strong>
              </span>
              <button
                type="button"
                className="rounded-[10px] border border-[#d4e2f3] bg-white px-3 py-2 text-xs font-semibold text-[#3974bd] transition-colors hover:bg-[#f3f8ff] disabled:cursor-wait disabled:opacity-60"
                disabled={isWorking || isChoosingDirectory}
                onClick={onChangeDirectory}
              >
                {isChoosingDirectory ? "选择中…" : "更改"}
              </button>
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={isWorking} onClick={onDiscard}>
                不保存
              </Button>
              <Button variant="secondary" disabled={isWorking} onClick={onContinue}>
                继续录音
              </Button>
              <Button disabled={isWorking} onClick={onSave}>
                {isWorking ? "正在保存…" : "保存"}
              </Button>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
