import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";

import { useAppStore } from "../../store/appStore";
import { reducedFadeVariants, toastItemVariants } from "../../features/motion/motionPresets";
import { usePrefersReducedMotion as useReducedMotion } from "../../hooks/usePrefersReducedMotion";

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
            <motion.div
              key={toast.id}
              variants={shouldReduceMotion ? reducedFadeVariants : toastItemVariants}
              initial="initial"
              animate="open"
              exit="closed"
              role={tone === "danger" ? "alert" : "status"}
              className={`toast-card pointer-events-auto flex min-h-14 items-center gap-3 rounded-[18px] px-3.5 py-2.5 text-left ${classes.card}`}
            >
              <span
                className={`toast-icon grid h-7 w-7 shrink-0 place-items-center rounded-full ${classes.icon}`}
              >
                <ToneIcon className="h-4 w-4" />
              </span>
              <span className="toast-copy min-w-0 flex-1">
                <span
                  className={`toast-title block text-balance text-[13px] font-bold ${classes.title}`}
                >
                  {toast.title}
                  {(toast.repeatCount ?? 1) > 1 ? (
                    <span className="toast-repeat-count">×{toast.repeatCount}</span>
                  ) : null}
                </span>
                {toast.description ? (
                  <span
                    className={`mt-0.5 block break-words text-pretty text-[12px] leading-[18px] ${classes.description}`}
                  >
                    {toast.description}
                  </span>
                ) : null}
              </span>
              {toast.actionLabel && toast.onAction ? (
                <button
                  type="button"
                  className="shrink-0 rounded-[10px] border border-current/15 bg-white/55 px-2.5 py-1.5 text-xs font-bold"
                  onClick={() => {
                    toast.onAction?.();
                    dismissToast(toast.id);
                  }}
                >
                  {toast.actionLabel}
                </button>
              ) : null}
              <button
                type="button"
                aria-label="关闭提示"
                title="关闭"
                className="grid size-9 shrink-0 place-items-center rounded-[10px] text-current/70 transition-colors hover:bg-white/55 hover:text-current"
                onClick={() => dismissToast(toast.id)}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
