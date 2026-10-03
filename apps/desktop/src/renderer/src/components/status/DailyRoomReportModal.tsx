import { CalendarDays } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import type { DailyRoomReport } from "@private-voice/shared";

import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import {
  buildDailyRoomReportHighlights,
  buildDailyRoomReportNarrative,
} from "../../features/daily-report/dailyRoomReportHighlights";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";
import { usePrefersReducedMotion as useReducedMotion } from "../../hooks/usePrefersReducedMotion";

export const DailyRoomReportModal = ({
  report,
  roomName = "房间",
  onClose,
}: {
  report: DailyRoomReport;
  roomName?: string;
  onClose: () => void;
}) => {
  const reduceMotion = useReducedMotion();
  const highlights = buildDailyRoomReportHighlights(report);
  const savedCommentary = report.commentary?.trim();
  const headline =
    savedCommentary && savedCommentary.split(/\r?\n/).filter((line) => line.trim()).length >= 2
      ? savedCommentary
      : buildDailyRoomReportNarrative(report);
  const narrativeParagraphs = headline
    .split(/\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <motion.div
      variants={reduceMotion ? reducedFadeVariants : overlayScrimVariants}
      initial="initial"
      animate="open"
      exit="closed"
      className="modal-scrim fixed inset-0 z-[87] flex items-start justify-center overflow-y-auto p-4 sm:p-6"
    >
      <motion.section
        variants={reduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
        initial="initial"
        animate="open"
        exit="closed"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-room-report-title"
        className="modal-surface daily-report-dialog relative my-auto max-h-[calc(100dvh-32px)] w-full max-w-[560px] overflow-y-auto overscroll-contain rounded-[30px] p-6 sm:max-h-[calc(100dvh-48px)] sm:p-7"
      >
        <div className="absolute right-5 top-5">
          <DialogCloseButton onClick={onClose} />
        </div>
        <div className="daily-report-meta inline-flex items-center gap-2 text-xs font-semibold text-[#4779b8]">
          <CalendarDays className="h-4 w-4" /> {report.date} · {roomName}
        </div>
        <h2
          id="daily-room-report-title"
          className="daily-report-title mt-3 pr-12 text-balance text-[28px] font-bold text-[#172235]"
        >
          昨日房间
        </h2>
        <div className="daily-report-narrative">
          {narrativeParagraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        {highlights.length ? (
          <section
            className="daily-report-highlights grid grid-cols-1 gap-3 sm:grid-cols-2"
            aria-label="昨日亮点"
          >
            {highlights.map((highlight) => (
              <div
                key={highlight.id}
                className={`daily-report-highlight rounded-2xl border border-[#d9e8f8] bg-white/55 p-4 ${
                  highlight.id === "room-title" ? "sm:col-span-2" : ""
                }`}
              >
                <small className="block text-xs font-semibold text-[#7b91aa]">
                  {highlight.label}
                </small>
                <strong className="mt-1.5 block text-pretty text-[15px] font-semibold leading-relaxed text-[#29435f]">
                  {highlight.value}
                </strong>
                {highlight.detail ? (
                  <span className="mt-2 block text-pretty text-[13px] leading-relaxed text-[#6c839d]">
                    {highlight.detail}
                  </span>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
        <div className="sticky bottom-0 -mx-2 mt-4 bg-gradient-to-t from-[#f7fbff] via-[#f7fbff]/95 to-transparent px-2 pt-3">
          <Button isFullWidth onClick={onClose}>
            知道了
          </Button>
        </div>
      </motion.section>
    </motion.div>,
    document.body,
  );
};
