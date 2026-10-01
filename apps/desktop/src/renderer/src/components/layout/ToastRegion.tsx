import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, X, XCircle } from "lucide-react";
import { cn } from "@private-voice/ui";

import { useAppStore, type ToastMessage } from "../../store/appStore";
import { toastStackDepth } from "../../features/notifications/toastQueue";
import { reducedFadeVariants, toastItemVariants } from "../../features/motion/motionPresets";
import { usePrefersReducedMotion as useReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { RecordingClipToastActions } from "./RecordingClipToastActions";

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
  return (
    <AnimatePresence>
      {toasts.length ? (
        <ToastStack key="notifications" toasts={toasts} dismissToast={dismissToast} />
      ) : null}
    </AnimatePresence>
  );
};

const ToastStack = ({
  toasts,
  dismissToast,
}: {
  toasts: ToastMessage[];
  dismissToast: (id: string) => void;
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [isExpanded, setExpanded] = useState(false);
  const expanded = isExpanded && toasts.length > 1;
  const ordered = [...toasts].reverse();
  const visible = expanded ? ordered : ordered.slice(0, 1);
  const depth = toastStackDepth(toasts);

  return (
    <motion.div
      variants={shouldReduceMotion ? reducedFadeVariants : toastItemVariants}
      initial="initial"
      animate="open"
      exit="closed"
      className="toast-region pointer-events-none fixed left-1/2 top-[74px] z-[100] w-[min(360px,calc(100vw-32px))] -translate-x-1/2"
      aria-live="polite"
      aria-atomic="false"
    >
      <div className={cn("toast-stack", expanded && "is-expanded")}>
        {!expanded &&
          Array.from({ length: Math.max(0, depth - 1) }, (_, index) => {
            const level = index + 1;
            const tone = ordered[level]?.tone ?? ordered[0]?.tone ?? "neutral";
            return (
              <div
                key={level}
                aria-hidden="true"
                className={cn("toast-card toast-stack-back", toneClasses[tone].card)}
                data-depth={level}
              />
            );
          })}
        <div id="notification-cards" className="toast-stack-cards">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((toast) => {
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
                  className={cn(
                    "toast-card toast-stack-front pointer-events-auto flex min-h-14 items-center gap-3 rounded-[18px] px-3.5 py-2.5 text-left",
                    classes.card,
                  )}
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
                    {toast.clipFilePath && (
                      <RecordingClipToastActions filePath={toast.clipFilePath} />
                    )}
                  </span>
                  {toast.actionLabel && toast.onAction ? (
                    <button
                      type="button"
                      className="shrink-0 rounded-[10px] border border-current/15 bg-white/55 px-2.5 py-1.5 text-xs font-bold"
                      onClick={() => {
                        dismissToast(toast.id);
                        toast.onAction?.();
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
      </div>
      {toasts.length > 1 && (
        <button
          type="button"
          className="toast-stack-toggle pointer-events-auto"
          aria-expanded={expanded}
          aria-controls="notification-cards"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起通知" : `展开 ${toasts.length} 条通知`}
          <ChevronDown className={cn("size-3.5", expanded && "rotate-180")} aria-hidden="true" />
        </button>
      )}
    </motion.div>
  );
};
