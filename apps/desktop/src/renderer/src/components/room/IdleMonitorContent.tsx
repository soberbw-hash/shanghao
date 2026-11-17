import type { CSSProperties } from "react";

import windowSkyArtwork from "../../assets/scenes/idle-monitors/window-sky.png";
import windowSkyHd from "../../assets/scenes/idle-monitors/hd/window-sky.png";

interface IdleMonitorStyle extends CSSProperties {
  "--idle-monitor-offset": string;
}

export const IdleMonitorContent = ({
  offsetSeconds,
  shouldReduceMotion,
}: {
  offsetSeconds: number;
  shouldReduceMotion: boolean;
}) => {
  return (
    <span
      className={`scene-idle-monitor ${shouldReduceMotion ? "is-static-window" : ""}`}
      style={{ "--idle-monitor-offset": `${offsetSeconds}s` } as IdleMonitorStyle}
      role="img"
      aria-label="蓝天白云空闲屏保"
    >
      <img
        className="scene-idle-monitor-art scene-idle-monitor-art--window"
        src={shouldReduceMotion ? windowSkyArtwork : windowSkyHd}
        alt=""
        draggable={false}
        aria-hidden="true"
      />
      {!shouldReduceMotion && <span className="scene-idle-monitor-light" aria-hidden="true" />}
    </span>
  );
};
