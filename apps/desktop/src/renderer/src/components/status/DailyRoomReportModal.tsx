import { CalendarDays, Gamepad2, MessageCircle, MonitorUp } from "lucide-react";
import { motion } from "framer-motion";
import { createPortal } from "react-dom";

import type { DailyRoomReport } from "@private-voice/shared";

import { Button } from "../base/Button";
import { DialogCloseButton } from "../base/DialogCloseButton";
import { buildDailyRoomReportHighlights } from "../../features/daily-report/dailyRoomReportHighlights";
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
  const games = report.games.map((game) => game.name).join("、");
  const gameActivities = report.gameActivities ?? [];
  const highlights = buildDailyRoomReportHighlights(report);
  const savedCommentary = report.commentary?.trim();
  const hasRichCommentary = Boolean(
    savedCommentary && savedCommentary.split(/\r?\n/).filter((line) => line.trim()).length >= 2,
  );
  const headline =
    (hasRichCommentary ? savedCommentary : undefined) ||
    (gameActivities.length
      ? `${gameActivities[0]?.nickname} 昨天开了一局，房间总算留下了点游戏战绩 🎮\n人来得不算少，至少不是开着房间集体挂机。`
      : report.participantCount >= 4
        ? "昨天又凑成了一桌，热闹得像临时开了个小型发布会 🎉\n人多、气氛也在，房间没有白白占着位置。"
        : report.messageCount >= 10
          ? `昨天聊得不算少，房间总算没有白开 💬\n${report.messageCount} 条消息，至少比“进来看看”认真多了。`
          : games
            ? "昨天有人来开黑，也留下了游戏战绩 🎮\n人不算多，但好歹不是一间空房间。"
            : "昨天有人来坐了坐 ☕\n人不算多，但总比彻底长草强。");

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
      className="fixed inset-0 z-[87] grid place-items-center bg-[#eaf3ff]/88 p-6"
    >
      <motion.section
        variants={reduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
        initial="initial"
        animate="open"
        exit="closed"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-room-report-title"
        className="modal-surface relative max-h-[calc(100vh-48px)] w-full max-w-[520px] overflow-y-auto rounded-[30px] p-7"
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
        <p className="mt-2 whitespace-pre-line text-pretty text-sm font-semibold leading-6 text-[#526a86]">
          {headline}
        </p>
        {report.games.length || gameActivities.length ? (
          <section className="daily-report-games" aria-label="昨天玩过的游戏">
            <div className="daily-report-games-title">
              <Gamepad2 aria-hidden="true" />
              <strong>昨天玩了</strong>
            </div>
            <div className="daily-report-game-list">
              {gameActivities.length
                ? gameActivities.map((activity, index) => (
                    <div
                      className="daily-report-game-activity"
                      key={`${activity.nickname}-${activity.gameName}-${index}`}
                    >
                      <strong>{activity.nickname}</strong>
                      <span>玩了《{activity.gameName}》</span>
                      <small>{formatDuration(activity.durationMs)}</small>
                    </div>
                  ))
                : report.games.map((game) => (
                    <span key={game.name}>
                      {game.name}
                      {game.participantCount > 1 ? <small>{game.participantCount} 人</small> : null}
                    </span>
                  ))}
            </div>
          </section>
        ) : null}
        {highlights.length ? (
          <section className="mt-5 grid grid-cols-2 gap-2.5" aria-label="昨日亮点">
            {highlights.map((highlight) => (
              <div
                key={highlight.id}
                className="rounded-2xl border border-[#d9e8f8] bg-white/55 p-3"
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
        <div className="mt-5 grid grid-cols-2 gap-3">
          {report.messageCount ? (
            <div className="daily-report-stat">
              <MessageCircle />
              <strong>{report.messageCount}</strong>
              <span>条消息</span>
            </div>
          ) : null}
          {report.screenShareCount ? (
            <div className="daily-report-stat">
              <MonitorUp />
              <strong>{report.screenShareCount}</strong>
              <span>次分享</span>
            </div>
          ) : null}
        </div>
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
        <Button isFullWidth className="mt-5" onClick={onClose}>
          知道了
        </Button>
      </motion.section>
    </motion.div>,
    document.body,
  );
};
import { useEffect } from "react";
