import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

import { useAppStore } from "../../store/appStore";
import { reducedFadeVariants, toastItemVariants } from "../../features/motion/motionPresets";

const toneClasses = {
  neutral: {
    card: "toast-neutral",
    icon: "text-[#40546B]",
    title: "text-[#243247]",
    description: "text-[#475569]",
  },
  success: {
    card: "toast-success",
    icon: "text-[#0A7A44]",
    title: "text-[#0D6B3A]",
    description: "text-[#315D49]",
  },
  warning: {
    card: "toast-warning",
    icon: "text-[#9A5B05]",
    title: "text-[#8A5004]",
    description: "text-[#704A1A]",
  },
  danger: {
    card: "toast-danger",
    icon: "text-[#B42318]",
    title: "text-[#A61B13]",
    description: "text-[#71302B]",
  },
} as const;

const toneIcons = {
  neutral: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

export const ToastRegion = () => {
  const toasts = useAppStore((state) => state.toasts);
  const dismissToast = useAppStore((state) => state.dismissToast);
  const shouldReduceMotion = useReducedMotion();

  return (
    <div
      className="pointer-events-none fixed left-1/2 top-[74px] z-[100] flex w-[min(360px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence initial={false} mode="popLayout">
        {toasts.map((toast) => {
          const tone = toast.tone ?? "neutral";
          const ToneIcon = toneIcons[tone];
          const classes = toneClasses[tone];
          return (
            <motion.button
              key={toast.id}
              layout="position"
              variants={shouldReduceMotion ? reducedFadeVariants : toastItemVariants}
              initial="initial"
              animate="open"
              exit="closed"
              className={`toast-card pointer-events-auto flex items-start gap-3 rounded-[18px] px-3.5 py-3 text-left ${classes.card}`}
              onClick={() => dismissToast(toast.id)}
            >
              <span
                className={`toast-icon mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${classes.icon}`}
              >
                <ToneIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className={`block text-[13px] font-bold ${classes.title}`}>
                  {toast.title}
                  {(toast.repeatCount ?? 1) > 1 ? (
                    <span className="toast-repeat-count">×{toast.repeatCount}</span>
                  ) : null}
                </span>
                {toast.description ? (
                  <span
                    className={`mt-0.5 block text-[12px] leading-[18px] ${classes.description}`}
                  >
                    {toast.description}
                  </span>
                ) : null}
              </span>
            </motion.button>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
