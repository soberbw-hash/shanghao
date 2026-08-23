import { useState } from "react";
import { Circle } from "lucide-react";

import { useVisibleInterval } from "../../hooks/useVisualVisibility";

const MONTH_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  month: "long",
});
const DAY_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Shanghai",
  day: "numeric",
});
const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  weekday: "long",
});
const YEAR_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
});
const DATE_ATTRIBUTE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
});

export const RoomDateCalendar = () => {
  const [today, setToday] = useState(() => new Date());

  useVisibleInterval(() => setToday(new Date()), 60_000);

  return (
    <div
      className="room-date-calendar"
      aria-label={`今天是${YEAR_FORMATTER.format(today)}${MONTH_FORMATTER.format(today)}${DAY_FORMATTER.format(today)}日，${WEEKDAY_FORMATTER.format(today)}`}
    >
      <div className="room-date-calendar-paper">
        <span className="room-date-calendar-head">
          <span className="room-date-calendar-rings" aria-hidden="true">
            <Circle />
            <Circle />
          </span>
          <span className="room-date-calendar-month" aria-hidden="true">
            {MONTH_FORMATTER.format(today)}
          </span>
        </span>
        <time
          className="room-date-calendar-today"
          dateTime={DATE_ATTRIBUTE_FORMATTER.format(today)}
        >
          <strong>{DAY_FORMATTER.format(today)}</strong>
          <span aria-hidden="true">{WEEKDAY_FORMATTER.format(today)}</span>
        </time>
      </div>
      <span className="scene-ambient-tooltip room-date-calendar-tooltip" role="tooltip">
        {FULL_DATE_FORMATTER.format(today)}
      </span>
    </div>
  );
};
