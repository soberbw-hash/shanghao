import { CalendarDays, MessageCircle, MonitorUp, Users } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";

import type { DailyRoomReport } from "@private-voice/shared";

import { Button } from "../base/Button";
import {
  dialogSurfaceVariants,
  overlayScrimVariants,
  reducedFadeVariants,
} from "../../features/motion/motionPresets";

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
  const games = report.games
    .map((game) => game.name)
    .slice(0, 3)
    .join("、");

  return (
    <motion.div
      variants={reduceMotion ? reducedFadeVariants : overlayScrimVariants}
      initial="initial"
      animate="open"
      exit="closed"
      className="fixed inset-0 z-[87] grid place-items-center bg-[#eaf3ff]/68 p-6 backdrop-blur-xl"
    >
      <motion.section
        variants={reduceMotion ? reducedFadeVariants : dialogSurfaceVariants}
        initial="initial"
        animate="open"
        exit="closed"
        role="dialog"
        aria-modal="true"
        aria-labelledby="daily-room-report-title"
        className="modal-surface w-full max-w-[520px] rounded-[30px] p-7"
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
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="daily-report-stat">
            <Users />
            <strong>{report.participantCount}</strong>
            <span>位朋友</span>
          </div>
          <div className="daily-report-stat">
            <MessageCircle />
            <strong>{report.messageCount}</strong>
            <span>条消息</span>
          </div>
          <div className="daily-report-stat">
            <MonitorUp />
            <strong>{report.screenShareCount}</strong>
            <span>次分享</span>
          </div>
        </div>
        <div className="mt-4 rounded-[18px] border border-[#dce9f7] bg-white/58 px-4 py-3 text-sm leading-6 text-[#5f7188]">
          房间活跃 {formatDuration(report.activeDurationMs)}，最高同时 {report.peakConcurrent} 人。
          {games ? ` 玩过：${games}。` : ""}
          {report.lastExit ? ` 最后离开的是 ${report.lastExit.nickname}。` : ""}
        </div>
        <Button isFullWidth className="mt-5" onClick={onClose}>
          知道了
        </Button>
      </motion.section>
    </motion.div>
  );
};
