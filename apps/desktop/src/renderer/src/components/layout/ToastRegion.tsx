import { AnimatePresence, motion } from "framer-motion";

import { useAppStore } from "../../store/appStore";

export const ToastRegion = () => {
  const toasts = useAppStore((state) => state.toasts);
  const dismissToast = useAppStore((state) => state.dismissToast);

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-80 flex-col gap-3">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.button
            key={toast.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-auto rounded-[18px] border border-white/8 bg-[#111723] p-4 text-left shadow-panel"
            onClick={() => dismissToast(toast.id)}
          >
            <div className="text-sm font-medium text-white">{toast.title}</div>
            {toast.description ? (
              <p className="mt-1 text-sm text-white/55">{toast.description}</p>
            ) : null}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
};
