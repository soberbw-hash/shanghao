import { CalendarDays, MessageCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import type { DailyRoomReport } from "@private-voice/shared";

import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import {
  buildDailyRoomReportHighlights,
  buildDailyRoomReportFacts,
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
  const facts = buildDailyRoomReportFacts(report);

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
          <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span className="truncate" title={roomName}>
            {report.date} · {roomName}
          </span>
        </div>
        <h2
          id="daily-room-report-title"
          className="daily-report-title mt-3 pr-12 text-balance text-[28px] font-bold text-[#172235]"
        >
          昨日回顾
        </h2>
        {highlights.length ? (
          <section className="daily-report-moments" aria-labelledby="daily-room-moments-title">
            <h3 id="daily-room-moments-title">
              <MessageCircle aria-hidden="true" className="h-4 w-4 shrink-0" />
              聊了什么
            </h3>
            <ul>
              {highlights.map(({ id, value, detail }) => (
                <li key={id}>
                  {detail ? (
                    <>
                      <strong>{value}</strong>
                      <p>{detail}</p>
                    </>
                  ) : (
                    <p>{value}</p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="mt-4 text-sm text-[#516985]">这天没有可回顾的对话片段。</p>
        )}
        {facts.length ? (
          <ul className="daily-report-facts" aria-label="房间活动">
            {facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-5 flex justify-end">
          <Button onClick={onClose}>返回</Button>
        </div>
      </motion.section>
    </motion.div>,
    document.body,
  );
};
