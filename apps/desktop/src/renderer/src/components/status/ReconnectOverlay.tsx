import { useEffect, useRef, useState } from "react";
import { LoaderCircle, LogOut, RotateCw } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";
import { usePrefersReducedMotion as useReducedMotion } from "../../hooks/usePrefersReducedMotion";

const RECONNECT_SHOW_DELAY_MS = 350;
const RECONNECT_MIN_VISIBLE_MS = 600;
const RECONNECT_ACTION_DELAY_MS = 8_000;

export const ReconnectOverlay = ({
  isVisible,
  onRetry,
  onLeave,
}: {
  isVisible: boolean;
  onRetry: () => boolean;
  onLeave: () => void;
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [shouldRender, setShouldRender] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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

  useEffect(() => {
    if (!isVisible) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const updateElapsed = () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timer);
  }, [isVisible]);

  const showActions = elapsedSeconds * 1_000 >= RECONNECT_ACTION_DELAY_MS;

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
          className="pointer-events-none fixed inset-x-0 top-[76px] z-[96] flex justify-center px-4"
        >
          <motion.div
            variants={shouldReduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
            initial="initial"
            animate="open"
            exit="closed"
            className="modal-surface pointer-events-auto flex max-w-[480px] items-center gap-3 rounded-[18px] px-5 py-4 text-sm text-[#475569]"
          >
            <LoaderCircle className="h-4 w-4 animate-spin text-[#4DA3FF]" />
            <span className="min-w-0 flex-1">
              <strong className="block text-[#26364d]">正在重新连接房间…</strong>
              <small className="mt-0.5 block text-[#718096]">
                麦克风和当前页面会保留{showActions ? ` · 已等待 ${elapsedSeconds} 秒` : ""}
              </small>
            </span>
            {showActions ? (
              <span className="flex shrink-0 gap-2">
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-[11px] bg-[#eaf3ff] px-3 font-semibold text-[#3974bd]"
                  onClick={() => onRetry()}
                >
                  <RotateCw className="size-4" aria-hidden="true" />
                  立即重试
                </button>
                <button
                  type="button"
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-[11px] px-3 font-semibold text-[#718096] hover:bg-[#f3f7fc]"
                  onClick={onLeave}
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  返回首页
                </button>
              </span>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
