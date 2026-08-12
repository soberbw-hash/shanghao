import { useEffect } from "react";
import { CheckCircle2, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { ReleaseHistoryEntry } from "./releaseHistory";

import { Button } from "../base/Button";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";

export const ReleaseDetailModal = ({
  release,
  onClose,
}: {
  release?: ReleaseHistoryEntry;
  onClose: () => void;
}) => {
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (!release) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose, release]);

  return (
    <AnimatePresence>
      {release ? (
        <motion.div
          key={release.version}
          variants={shouldReduceMotion ? reducedFadeVariants : overlayScrimVariants}
          initial="initial"
          animate="open"
          exit="closed"
          className="fixed inset-0 z-50 grid place-items-center bg-[#eaf3ff]/76 p-6 backdrop-blur-xl"
          onPointerDown={(event) => {
            if (event.currentTarget === event.target) onClose();
          }}
        >
          <motion.section
            variants={shouldReduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
            initial="initial"
            animate="open"
            exit="closed"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-detail-title"
            className="modal-surface max-h-[82vh] w-full max-w-[660px] overflow-hidden rounded-[28px]"
          >
            <header className="flex items-start justify-between gap-5 border-b border-[#dbe8f7]/80 px-6 py-5">
              <div className="min-w-0">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f2ff] px-2.5 py-1 text-xs font-semibold text-[#3974d8]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  {release.date}
                </span>
                <h2
                  id="release-detail-title"
                  className="mt-3 text-balance text-[24px] font-bold text-[#172235]"
                >
                  上号 {release.version} · {release.title}
                </h2>
                <p className="mt-1.5 text-pretty text-sm leading-6 text-[#718096]">
                  下面是这个版本实际调整的具体内容。
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭更新详情"
                className="grid size-9 shrink-0 place-items-center rounded-[11px] border border-[#dbe8f7] bg-white text-[#718096] transition-colors hover:bg-[#f3f7fc] hover:text-[#26364d]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </header>

            <div className="max-h-[58vh] space-y-4 overflow-y-auto px-6 py-5">
              {release.details.map((section) => (
                <section
                  key={section.title}
                  className="rounded-[18px] border border-[#dbe8f7]/80 bg-white/72 p-4"
                >
                  <h3 className="text-sm font-bold text-[#314158]">{section.title}</h3>
                  <ul className="mt-3 grid gap-2.5">
                    {section.items.map((item) => (
                      <li
                        key={item}
                        className="flex items-start gap-2.5 text-sm leading-6 text-[#66758b]"
                      >
                        <CheckCircle2
                          className="mt-1 size-4 shrink-0 text-[#4d91e6]"
                          aria-hidden="true"
                        />
                        <span className="text-pretty">{item}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>

            <footer className="flex justify-end border-t border-[#dbe8f7]/80 px-6 py-4">
              <Button variant="secondary" onClick={onClose}>
                看完了
              </Button>
            </footer>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
