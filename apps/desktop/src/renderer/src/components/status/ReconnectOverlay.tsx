import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";

const RECONNECT_SHOW_DELAY_MS = 350;
const RECONNECT_MIN_VISIBLE_MS = 600;

export const ReconnectOverlay = ({ isVisible }: { isVisible: boolean }) => {
  const shouldReduceMotion = useReducedMotion();
  const [shouldRender, setShouldRender] = useState(false);
  const visibleSinceRef = useRef(0);

  useEffect(() => {
    let timer: number | undefined;

    if (isVisible && !shouldRender) {
      timer = window.setTimeout(() => {
        visibleSinceRef.current = performance.now();
        setShouldRender(true);
      }, RECONNECT_SHOW_DELAY_MS);
    } else if (!isVisible && shouldRender) {
      const elapsed = performance.now() - visibleSinceRef.current;
      timer = window.setTimeout(
        () => setShouldRender(false),
        Math.max(0, RECONNECT_MIN_VISIBLE_MS - elapsed),
      );
    }

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [isVisible, shouldRender]);

  return (
    <AnimatePresence>
      {shouldRender ? (
        <motion.div
          key="reconnect-overlay"
          variants={shouldReduceMotion ? reducedFadeVariants : overlayScrimVariants}
          initial="initial"
          animate="open"
          exit="closed"
          role="status"
          aria-live="polite"
          className="modal-scrim pointer-events-auto fixed inset-0 flex items-center justify-center"
        >
          <motion.div
            variants={shouldReduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
            initial="initial"
            animate="open"
            exit="closed"
            className="modal-surface flex items-center gap-3 rounded-[18px] px-5 py-4 text-sm text-[#475569]"
          >
            <LoaderCircle className="h-4 w-4 animate-spin text-[#4DA3FF]" />
            正在重新连接房间…
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
