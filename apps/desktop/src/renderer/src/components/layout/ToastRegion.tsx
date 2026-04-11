import { AnimatePresence, motion } from "framer-motion";

import { useAppStore } from "../../store/appStore";

const toneClasses = {
  neutral: "border-[#E7ECF2] bg-white text-[#111827]",
  success: "border-[#C7E8D2] bg-[#ECFDF3] text-[#15803D]",
  warning: "border-[#FDE7B0] bg-[#FFFAEB] text-[#B45309]",
  danger: "border-[#F9D3D0] bg-[#FEF3F2] text-[#B42318]",
} as const;

export const ToastRegion = () => {
  const toasts = useAppStore((state) => state.toasts);
  const dismissToast = useAppStore((state) => state.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-[min(360px,calc(100vw-32px))] flex-col gap-3">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.button
            key={toast.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.18 }}
            className={`pointer-events-auto rounded-[18px] border p-4 text-left shadow-[0_12px_28px_rgba(17,24,39,0.08)] ${toneClasses[toast.tone ?? "neutral"]}`}
            onClick={() => dismissToast(toast.id)}
          >
            <div className="text-sm font-medium">{toast.title}</div>
            {toast.description ? (
              <p className="mt-1 text-sm opacity-80">{toast.description}</p>
            ) : null}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
};
