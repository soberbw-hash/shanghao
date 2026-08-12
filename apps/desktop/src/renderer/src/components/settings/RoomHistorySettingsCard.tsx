import { useEffect, useState } from "react";
import { ChevronDown, MessageCircle, MonitorUp, Users } from "lucide-react";

import type { AppSettings, DailyRoomReport } from "@private-voice/shared";

import { useDailyRoomReportStore } from "../../store/dailyRoomReportStore";
import { useRoomStore } from "../../store/roomStore";

const yesterday = (): string => {
  const date = new Date(Date.now() - 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(date);
};

const formatDuration = (milliseconds: number): string => {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分钟`;
};

const ReportDetails = ({ report }: { report: DailyRoomReport }) => (
  <div className="room-history-details">
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
    {report.games.length ? (
      <span className="col-span-full">
        玩过：{report.games.map((game) => game.name).join("、")}
      </span>
    ) : null}
  </div>
);

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
          <div className="room-history-empty">当前服务器暂不支持房间记录。</div>
        ) : null}
        {loaded && !unavailable && reports.length === 0 ? (
          <div className="room-history-empty">暂无房间记录。</div>
        ) : null}
        {loaded &&
          !unavailable &&
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
                      {report.hadActivity ? `${report.participantCount} 人来过` : "安静的一天"}
                    </small>
                  </span>
                  <ChevronDown className={expanded ? "rotate-180" : ""} />
                </button>
                {expanded ? (
                  report.hadActivity ? (
                    <ReportDetails report={report} />
                  ) : (
                    <div className="room-history-quiet">这天没有实际房间活动。</div>
                  )
                ) : null}
              </article>
            );
          })}
      </div>
    </section>
  );
};
