import { CalendarDays, Gamepad2, MessageCircle, MonitorUp, Users } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { createPortal } from "react-dom";

import type { DailyRoomReport } from "@private-voice/shared";

import { Button } from "../base/Button";
import { buildDailyRoomReportHighlights } from "../../features/daily-report/dailyRoomReportHighlights";
import { overlayScrimVariants, reducedFadeVariants } from "../../features/motion/motionPresets";

const reportSurfaceVariants = {
  initial: { opacity: 0, y: 8, scale: 0.985 },
  open: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] },
  },
  closed: {
    opacity: 0,
    y: 4,
    scale: 0.992,
    transition: { duration: 0.12, ease: [0.4, 0, 1, 1] },
  },
} as const;

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
  const participantNames = report.participantNicknames
    .map((nickname) => nickname.trim())
    .filter(Boolean);
  const highlights = buildDailyRoomReportHighlights(report);
  const headline = gameActivities.length
    ? `${gameActivities[0]?.nickname} 昨天开了一局，房间里留下了游戏时间 🎮`
    : report.participantCount >= 4
      ? "昨天又凑成了一桌，热闹得很 🎉"
      : report.messageCount >= 10
        ? "昨天聊了不少，房间没白开 💬"
        : games
          ? "昨天有人来开黑，也留下了战绩 🎮"
          : "昨天有人来坐了坐，房间记得这次碰面 ☕";

  return createPortal(
    <motion.div
      variants={reduceMotion ? reducedFadeVariants : overlayScrimVariants}
      initial="initial"
      animate="open"
      exit="closed"
      className="fixed inset-0 z-[87] grid place-items-center bg-[#eaf3ff]/88 p-6"
    >
      <motion.section
        variants={reduceMotion ? reducedFadeVariants : reportSurfaceVariants}
        initial="initial"
        animate="open"
        exit="closed"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-room-report-title"
        className="modal-surface max-h-[calc(100vh-48px)] w-full max-w-[520px] overflow-y-auto rounded-[30px] p-7"
      >
        <div className="inline-flex items-center gap-2 text-xs font-bold text-[#4779b8]">
          <CalendarDays className="h-4 w-4" /> {report.date} · {roomName}
        </div>
        <h2
          id="daily-room-report-title"
          className="mt-3 text-[28px] font-[760] tracking-[-0.04em] text-[#172235]"
        >
          昨日房间
        </h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-[#526a86]">{headline}</p>
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
        {participantNames.length ? (
          <section className="daily-report-friends" aria-label="昨天来过的朋友">
            <div className="daily-report-friends-title">
              <Users aria-hidden="true" />
              <strong>昨天都有谁</strong>
              <span>{participantNames.length} 位朋友</span>
            </div>
            <div className="daily-report-friend-list">
              {participantNames.map((nickname, index) => (
                <span key={`${nickname}-${index}`}>{nickname}</span>
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
        <div className="mt-5 grid grid-cols-3 gap-3">
          {report.participantCount ? (
            <div className="daily-report-stat">
              <Users />
              <strong>{report.participantCount}</strong>
              <span>位朋友</span>
            </div>
          ) : null}
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
