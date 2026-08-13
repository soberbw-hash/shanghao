import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type { MusicActivity, MusicProviderId } from "@private-voice/shared";
import { cn } from "@private-voice/ui";

import appleMusicIcon from "../../assets/apple-music.png";

const providerPath: Record<Exclude<MusicProviderId, "applemusic">, string> = {
  spotify:
    "M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.52 17.34c-.24.36-.66.48-1.02.24-2.82-1.74-6.36-2.1-10.56-1.14-.42.12-.78-.18-.9-.54-.12-.42.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.48.66.3 1.02zm1.44-3.3c-.3.42-.84.6-1.26.3-3.24-1.98-8.16-2.58-11.94-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.14C9.6 9.9 15 10.56 18.72 12.84c.36.18.54.78.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.3c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.62.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3z",
  netease:
    "M13.05 9.39c-.23.05-.45.11-.66.19-.81.31-1.45.99-1.67 1.77-.08.28-.1.55-.07.81.05.55.33 1.05.76 1.35.65.45 1.53.33 2.01-.29.41-.53.36-1.18.24-1.63-.1-.39-.22-.82-.35-1.25l-.26-.95zm-.82 10.07A7.23 7.23 0 0 1 5 12.24c0-.98.23-3.02 1.88-4.82A7.2 7.2 0 0 1 9.5 5.6a.79.79 0 1 1 .59 1.47 5.64 5.64 0 0 0-3.5 5.16 5.64 5.64 0 0 0 10.18 3.21c1.04-1.68.77-3.93-.63-5.24a3.3 3.3 0 0 0-1.44-.77c.17.59.34 1.18.5 1.77.28 1.12.1 2.18-.52 2.99a3.03 3.03 0 0 1-4.17.62 3.45 3.45 0 0 1-1.44-2.51c-.04-.47 0-.93.13-1.38.35-1.25 1.35-2.34 2.62-2.82.27-.11.55-.19.82-.25l-.13-.51c-.37-1.37.25-2.58 1.55-3.01.33-.11.68-.15 1.02-.11.79.09 1.48.59 1.71 1.02.26.51-.1 1.16-.71 1.16a.79.79 0 0 1-.54-.22c-.25-.24-.56-.38-.89-.38-.35.01-.66.23-.76.56-.06.19-.03.4.02.59l.22.82c1.11.1 2.16.54 2.97 1.3 1.97 1.84 2.35 4.88.89 7.23-1.2 1.93-3.51 3.18-5.89 3.18zM0 12a12 12 0 1 0 24 0 12 12 0 0 0-24 0z",
  qqmusic:
    "M15.8 2.2a1.2 1.2 0 0 1 1.7 1.09v10.76a3.66 3.66 0 1 1-1.72-3.1V6.29l-6.9 1.64v8.15a3.66 3.66 0 1 1-1.72-3.1V7.02c0-.56.39-1.05.94-1.18l7.7-1.83V2.2z",
};

const providerColor: Record<MusicProviderId, string> = {
  spotify: "#1ed760",
  netease: "#d43c33",
  qqmusic: "#1ebafc",
  applemusic: "#fa243c",
};

export const MusicActivityBadge = ({ activity }: { activity: MusicActivity }) => {
  const displayText = activity.artist
    ? `${activity.trackTitle} · ${activity.artist}`
    : activity.trackTitle;
  const tooltipId = useId();
  const marqueeRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [shouldScroll, setShouldScroll] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);

  const openTooltip = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = undefined;
    setIsTooltipOpen(true);
  };

  const scheduleTooltipClose = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      setIsTooltipOpen(false);
    }, 220);
  };

  useEffect(
    () => () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const marquee = marqueeRef.current;
    const text = textRef.current;
    if (!marquee || !text) return;

    const measure = () => setShouldScroll(text.scrollWidth > marquee.clientWidth + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(marquee);
    observer.observe(text);
    return () => observer.disconnect();
  }, [displayText]);

  return (
    <div
      className={`music-activity-badge ${isTooltipOpen ? "is-tooltip-open" : ""}`}
      tabIndex={0}
      aria-label={`${activity.providerName}：${displayText}`}
      aria-describedby={tooltipId}
      aria-expanded={isTooltipOpen}
      onPointerEnter={openTooltip}
      onPointerLeave={scheduleTooltipClose}
      onFocus={openTooltip}
      onBlur={scheduleTooltipClose}
      onKeyDown={(event) => {
        if (event.key === "Escape") setIsTooltipOpen(false);
      }}
    >
      <span
        className={cn(
          "music-activity-icon",
          activity.provider === "applemusic" && "is-apple-music",
          activity.provider === "spotify" && "is-spotify",
        )}
        style={{ color: providerColor[activity.provider] }}
      >
        {activity.provider === "applemusic" ? (
          <img src={appleMusicIcon} alt="" aria-hidden="true" draggable={false} />
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d={providerPath[activity.provider]} />
          </svg>
        )}
        <i aria-hidden="true" />
      </span>
      <span id={tooltipId} className="music-activity-tooltip" role="tooltip">
        <strong>{activity.providerName}</strong>
        <span ref={marqueeRef} className="music-activity-marquee">
          <span className={`music-activity-marquee-track ${shouldScroll ? "is-scrolling" : ""}`}>
            <span ref={textRef} className="music-activity-marquee-item">
              {displayText}
            </span>
            {shouldScroll ? (
              <span className="music-activity-marquee-item" aria-hidden="true">
                {displayText}
              </span>
            ) : null}
          </span>
        </span>
      </span>
    </div>
  );
};
