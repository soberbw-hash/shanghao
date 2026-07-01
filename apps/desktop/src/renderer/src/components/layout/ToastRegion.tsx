import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

import { useAppStore } from "../../store/appStore";

const toneClasses = {
  neutral: "border-white/75 bg-white/82 text-[#243247]",
  success: "border-[#BDE9D0]/80 bg-[#ECFDF3]/88 text-[#147A43]",
  warning: "border-[#F7D999]/80 bg-[#FFF8E8]/90 text-[#A66208]",
  danger: "border-[#F2C4C1]/80 bg-[#FFF0EF]/90 text-[#B42318]",
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
    <div
      className="pointer-events-none fixed left-1/2 top-[74px] z-[100] flex w-[min(360px,calc(100vw-32px))] -translate-x-1/2 flex-col gap-2"
      aria-live="polite"
      aria-atomic="false"
    >
      <AnimatePresence>
        {toasts.map((toast) => {
          const tone = toast.tone ?? "neutral";
          const ToneIcon = toneIcons[tone];
          return (
            <motion.button
              key={toast.id}
              initial={{ opacity: 0, y: -10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.985 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={`pointer-events-auto flex items-start gap-3 rounded-[18px] border px-3.5 py-3 text-left shadow-[0_16px_40px_rgba(48,80,122,0.14),inset_0_1px_0_rgba(255,255,255,.9)] backdrop-blur-xl ${toneClasses[tone]}`}
              onClick={() => dismissToast(toast.id)}
            >
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/68 shadow-sm">
                <ToneIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold">{toast.title}</span>
                {toast.description ? (
                  <span className="mt-0.5 block text-[12px] leading-[18px] opacity-75">
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
