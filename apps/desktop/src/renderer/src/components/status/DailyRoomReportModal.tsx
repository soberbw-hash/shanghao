import { CalendarDays, Gamepad2 } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { createPortal } from "react-dom";

import type { DailyRoomReport } from "@private-voice/shared";

import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import {
  buildDailyRoomReportHighlights,
  buildDailyRoomReportNarrative,
  hasMeaningfulDailyRoomGameData,
} from "../../features/daily-report/dailyRoomReportHighlights";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";
import { usePrefersReducedMotion as useReducedMotion } from "../../hooks/usePrefersReducedMotion";

const formatDuration = (milliseconds: number): string => {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
};

export const DailyRoomReportModal = ({
  report,
  onClose,
}: {
  report: DailyRoomReport;
  onClose: () => void;
}) => {
  const reduceMotion = useReducedMotion();
  const roomName = report.roomId === "side" ? "二号房" : "一号房";
  const gameActivities = hasMeaningfulDailyRoomGameData(report)
    ? (report.gameActivities ?? []).filter((activity) => activity.durationMs >= 60_000)
    : [];
  const highlights = buildDailyRoomReportHighlights(report);
  const savedCommentary = report.commentary?.trim();
  const headline =
    savedCommentary && savedCommentary.split(/\r?\n/).filter((line) => line.trim()).length >= 2
      ? savedCommentary
      : buildDailyRoomReportNarrative(report);

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
      className="fixed inset-0 z-[87] flex items-start justify-center overflow-y-auto bg-[#eaf3ff]/88 p-4 sm:p-6"
    >
      <motion.section
        variants={reduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
        initial="initial"
        animate="open"
        exit="closed"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-room-report-title"
        className="modal-surface relative my-auto max-h-[calc(100vh-32px)] w-full max-w-[520px] overflow-y-auto overscroll-contain rounded-[30px] p-6 sm:max-h-[calc(100vh-48px)] sm:p-7"
      >
        <div className="absolute right-5 top-5">
          <DialogCloseButton onClick={onClose} />
        </div>
        <div className="inline-flex items-center gap-2 text-xs font-bold text-[#4779b8]">
          <CalendarDays className="h-4 w-4" /> {report.date} · {roomName}
        </div>
        <h2
          id="daily-room-report-title"
          className="mt-3 pr-12 text-[28px] font-[760] tracking-[-0.04em] text-[#172235]"
        >
          昨日房间
        </h2>
        <p className="mt-2 whitespace-pre-line text-pretty text-sm font-semibold leading-[1.65] text-[#526a86]">
          {headline}
        </p>
        {gameActivities.length ? (
          <section className="daily-report-games" aria-label="昨天玩过的游戏">
            <div className="daily-report-games-title">
              <Gamepad2 aria-hidden="true" />
              <strong>昨天玩了</strong>
            </div>
            <div className="daily-report-game-list">
              {gameActivities.map((activity, index) => (
                <div
                  className="daily-report-game-activity"
                  key={`${activity.nickname}-${activity.gameName}-${index}`}
                >
                  <strong>{activity.nickname}</strong>
                  <span>玩了《{activity.gameName}》</span>
                  <small>{formatDuration(activity.durationMs)}</small>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {highlights.length ? (
          <section className="mt-4 grid grid-cols-2 gap-2.5" aria-label="昨日亮点">
            {highlights.map((highlight) => (
              <div
                key={highlight.id}
                className={`rounded-2xl border border-[#d9e8f8] bg-white/55 p-3 ${
                  highlight.id === "room-title" ? "col-span-2" : ""
                }`}
              >
                <small className="block text-[11px] font-bold text-[#7b91aa]">
                  {highlight.label}
                </small>
                <strong className="mt-1 block truncate text-sm text-[#29435f]">
                  {highlight.value}
                </strong>
                {highlight.detail ? (
                  <span className="mt-0.5 block text-xs text-[#6c839d]">{highlight.detail}</span>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}
        <div className="daily-report-summary">
          <p>
            <span aria-hidden="true">⏱️</span>
            <span>一共热闹了 {formatDuration(report.activeDurationMs)}</span>
            <span>最高同时 {report.peakConcurrent} 人</span>
          </p>
          {report.lastExit ? (
            <p>
              <span aria-hidden="true">🌙</span>
              <span>最后离开的是 {report.lastExit.nickname}</span>
            </p>
          ) : null}
        </div>
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
