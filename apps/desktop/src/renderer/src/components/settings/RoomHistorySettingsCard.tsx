import { useEffect, useState } from "react";
import { ChevronDown, MessageCircle, MonitorUp, Users } from "lucide-react";
import { AnimatePresence } from "framer-motion";

import type { AppSettings, DailyRoomReport } from "@private-voice/shared";

import { useDailyRoomReportStore } from "../../store/dailyRoomReportStore";
import { useRoomStore } from "../../store/roomStore";
import { DailyRoomReportModal } from "../status/DailyRoomReportModal";

const yesterday = (): string => {
  const date = new Date(Date.now() - 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
};

const formatDuration = (milliseconds: number): string => {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分钟`;
};

const formatParticipantNames = (report: DailyRoomReport): string =>
  [
    ...new Map(
      report.participantNicknames
        .map((nickname) => nickname.trim())
        .filter(Boolean)
        .map((nickname) => [nickname.toLocaleLowerCase("zh-CN"), nickname] as const),
    ).values(),
  ].join("、");

const ReportDetails = ({ report, onOpen }: { report: DailyRoomReport; onOpen: () => void }) => {
  const participantNames = formatParticipantNames(report);
  const gameActivities = report.gameActivities ?? [];
  const workActivities = report.workActivities ?? [];

  return (
    <div className="room-history-details">
      {participantNames ? (
        <span className="room-history-friends">
          <Users />
          来过：{participantNames}
        </span>
      ) : null}
      <span>
        <Users />
        {report.participantCount} 人 · 最高 {report.peakConcurrent} 人
      </span>
      <span>
        <MessageCircle />
        {report.messageCount} 条消息
      </span>
      <span>
        <MonitorUp />
        {report.screenShareCount} 次分享
      </span>
      <span>活跃 {formatDuration(report.activeDurationMs)}</span>
      {gameActivities.length ? (
        <div className="room-history-game-activities">
          {gameActivities.map((activity, index) => (
            <span key={`${activity.nickname}-${activity.gameName}-${index}`}>
              <strong>{activity.nickname}</strong> 玩了《{activity.gameName}》·{" "}
              {formatDuration(activity.durationMs)}
            </span>
          ))}
        </div>
      ) : report.games.length ? (
        <span className="col-span-full">
          玩过：{report.games.map((game) => game.name).join("、")}
        </span>
      ) : null}
      {workActivities.length ? (
        <div className="room-history-game-activities">
          {workActivities.map((activity, index) => (
            <span key={`${activity.nickname}-${activity.workName}-${index}`}>
              <strong>{activity.nickname}</strong> 使用 {activity.workName} ·{" "}
              {formatDuration(activity.durationMs)}
            </span>
          ))}
        </div>
      ) : null}
      <button type="button" className="room-history-replay" onClick={onOpen}>
        重看昨日房间
      </button>
    </div>
  );
};

export const RoomHistorySettingsCard = ({
  settings,
  onChange,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => Promise<void> | void;
}) => {
  const currentRoomId = useRoomStore((state) => state.room.roomId);
  const [roomId, setRoomId] = useState<"main" | "side">(currentRoomId === "side" ? "side" : "main");
  const reports = useDailyRoomReportStore((state) => state.reports[roomId]);
  const loaded = useDailyRoomReportStore((state) => state.loaded[roomId]);
  const unavailable = useDailyRoomReportStore((state) => state.unavailable[roomId]);
  const [expandedDate, setExpandedDate] = useState<string>();
  const [previewReport, setPreviewReport] = useState<DailyRoomReport>();

  useEffect(() => {
    void useDailyRoomReportStore.getState().hydrate();
  }, []);

  useEffect(() => {
    setExpandedDate(reports[0]?.date);
  }, [reports, roomId]);

  const toggle = (report: DailyRoomReport) => {
    setExpandedDate((current) => (current === report.date ? undefined : report.date));
    if (report.date === yesterday()) {
      void onChange({
        lastDailyRoomReportSeen: { ...settings.lastDailyRoomReportSeen, [roomId]: report.date },
      });
    }
  };

  return (
    <section className="settings-section-card glass-panel rounded-[24px] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#24364c]">房间记录</h2>
          <p className="mt-1 text-sm text-[#718096]">最近 14 天，这个房间发生过什么。</p>
        </div>
        <div className="room-history-switch">
          <button
            type="button"
            className={roomId === "main" ? "is-active" : ""}
            onClick={() => setRoomId("main")}
          >
            一号房
          </button>
          <button
            type="button"
            className={roomId === "side" ? "is-active" : ""}
            onClick={() => setRoomId("side")}
          >
            二号房
          </button>
        </div>
      </div>
      <div className="mt-5 grid gap-2.5">
        {!loaded ? <div className="room-history-empty">正在读取…</div> : null}
        {unavailable ? (
          <div className="room-history-empty">
            {reports.length
              ? "当前显示本地记录，服务器暂时无法刷新。"
              : "当前服务器暂不支持房间记录。"}
          </div>
        ) : null}
        {loaded && !unavailable && reports.length === 0 ? (
          <div className="room-history-empty">暂无本地记录，进入一次房间后会自动同步。</div>
        ) : null}
        {loaded &&
          reports.map((report) => {
            const expanded = expandedDate === report.date;
            return (
              <article
                key={report.date}
                className={`room-history-day ${expanded ? "is-expanded" : ""}`}
              >
                <button type="button" onClick={() => toggle(report)} aria-expanded={expanded}>
                  <span>
                    <strong>{report.date}</strong>
                    <small>
                      {report.hadActivity
                        ? formatParticipantNames(report) || `${report.participantCount} 人来过`
                        : "安静的一天"}
                    </small>
                  </span>
                  <ChevronDown className={expanded ? "rotate-180" : ""} />
                </button>
                {expanded ? (
                  report.hadActivity ? (
                    <ReportDetails report={report} onOpen={() => setPreviewReport(report)} />
                  ) : (
                    <div className="room-history-quiet">这天没有实际房间活动。</div>
                  )
                ) : null}
              </article>
            );
          })}
      </div>
      <AnimatePresence>
        {previewReport ? (
          <DailyRoomReportModal
            report={previewReport}
            onClose={() => setPreviewReport(undefined)}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
};
