import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Info,
  MessageCircle,
  Sparkles,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@private-voice/ui";

import { useAppStore, type ToastMessage } from "../../store/appStore";
import { toastStackDepth } from "../../features/notifications/toastQueue";
import { reducedFadeVariants, toastItemVariants } from "../../features/motion/motionPresets";
import { usePrefersReducedMotion as useReducedMotion } from "../../hooks/usePrefersReducedMotion";
import { RecordingClipToastActions } from "./RecordingClipToastActions";
import { RecordingNoticeCard } from "./RecordingNoticeCard";
import gamepadIcon from "../../assets/room-icons/fluent/gamepad.png";

const isRecordingNotice = (toast: ToastMessage) =>
  toast.cardKind === "voice-replay" || toast.cardKind === "transcription";

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
      {toasts.some(isRecordingNotice) && (
        <ToastStack
          key="recordings"
          corner
          toasts={toasts.filter(isRecordingNotice)}
          dismissToast={dismissToast}
        />
      )}
      {toasts.some((item) => !isRecordingNotice(item)) && (
        <ToastStack
          key="notifications"
          toasts={toasts.filter((item) => !isRecordingNotice(item))}
          dismissToast={dismissToast}
        />
      )}
    </AnimatePresence>
  );
};

const ToastStack = ({
  toasts,
  dismissToast,
  corner = false,
}: {
  toasts: ToastMessage[];
  dismissToast: (id: string) => void;
  corner?: boolean;
}) => {
  const shouldReduceMotion = useReducedMotion();
  const [isExpanded, setExpanded] = useState(false);
  const expanded = isExpanded && toasts.length > 1;
  const ordered = [...toasts].reverse();
  const visible = expanded ? ordered : ordered.slice(0, 1);
  const depth = toastStackDepth(toasts);
  const cardsId = corner ? "recording-notification-cards" : "notification-cards";

  return (
    <motion.div
      variants={shouldReduceMotion ? reducedFadeVariants : toastItemVariants}
      initial="initial"
      animate="open"
      exit="closed"
      className={cn(
        "toast-region pointer-events-none fixed z-[100] w-[min(360px,calc(100vw-32px))]",
        corner ? "right-4 bottom-4" : "left-1/2 top-[74px] -translate-x-1/2",
      )}
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
        <div id={cardsId} className="toast-stack-cards">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((toast) => {
              if (isRecordingNotice(toast))
                return (
                  <motion.div
                    key={toast.id}
                    variants={shouldReduceMotion ? reducedFadeVariants : toastItemVariants}
                    initial="initial"
                    animate="open"
                    exit="closed"
                  >
                    <RecordingNoticeCard toast={toast} dismiss={() => dismissToast(toast.id)} />
                  </motion.div>
                );
              const tone = toast.tone ?? "neutral";
              const link = toast.chatPreview?.link;
              const ToneIcon = toast.chatPreview
                ? MessageCircle
                : toast.cardKind === "chronicle"
                  ? Sparkles
                  : toneIcons[tone];
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
                    toast.cardKind && "toast-content-card",
                    toast.cardKind === "knock" && "toast-knock",
                    classes.card,
                  )}
                  style={
                    toast.cardKind === "chronicle"
                      ? {
                          minHeight: 88,
                          padding: "14px 16px",
                          borderRadius: 20,
                          background:
                            "linear-gradient(135deg, rgba(248, 252, 255, 0.99), rgba(235, 246, 255, 0.98))",
                          boxShadow:
                            "0 16px 38px rgba(37, 68, 108, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.98)",
                        }
                      : undefined
                  }
                >
                  <span
                    className={`toast-icon grid h-7 w-7 shrink-0 place-items-center rounded-full ${classes.icon}`}
                  >
                    {toast.cardKind === "knock" ? (
                      <img src={gamepadIcon} alt="" />
                    ) : (
                      <ToneIcon className="h-4 w-4" />
                    )}
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
                    {toast.chatPreview?.image && (
                      <img
                        className="toast-chat-picture"
                        alt="收到的图片"
                        src={toast.chatPreview.image}
                      />
                    )}
                    {link && (
                      <button
                        type="button"
                        className="toast-chat-link"
                        onClick={() => {
                          void window.desktopApi.app
                            .openExternal(link)
                            .catch(() =>
                              useAppStore
                                .getState()
                                .pushToast({ title: "链接暂时无法打开", tone: "warning" }),
                            );
                        }}
                      >
                        <ExternalLink size={13} aria-hidden="true" />
                        打开链接
                      </button>
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
          aria-controls={cardsId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起通知" : `展开 ${toasts.length} 条通知`}
          <ChevronDown className={cn("size-3.5", expanded && "rotate-180")} aria-hidden="true" />
        </button>
      )}
    </motion.div>
  );
};
