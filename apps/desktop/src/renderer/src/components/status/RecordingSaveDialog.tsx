import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import { Button } from "../base/Button";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";

export const RecordingSaveDialog = ({
  isOpen,
  filePath,
  onClose,
}: {
  isOpen: boolean;
  filePath?: string;
  onClose: () => void;
}) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          key="recording-save-dialog"
          variants={shouldReduceMotion ? reducedFadeVariants : overlayScrimVariants}
          initial="initial"
          animate="open"
          exit="closed"
          className="modal-scrim pointer-events-auto fixed inset-0 flex items-center justify-center px-6"
        >
          <motion.div
            variants={shouldReduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
            initial="initial"
            animate="open"
            exit="closed"
            role="dialog"
            aria-modal="true"
            aria-labelledby="recording-save-title"
            className="modal-surface w-full max-w-lg rounded-[24px] p-6"
          >
            <div id="recording-save-title" className="text-[20px] font-semibold text-[#111827]">
              录音已保存
            </div>
            <p className="mt-2 text-sm leading-6 text-[#667085]">
              {filePath || "房间录音已经导出为 .m4a 文件。"}
            </p>
            <div className="mt-5">
              <Button variant="secondary" onClick={onClose}>
                关闭
              </Button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
