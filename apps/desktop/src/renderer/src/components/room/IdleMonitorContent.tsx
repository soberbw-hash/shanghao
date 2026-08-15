import type { CSSProperties } from "react";

import aquariumArtwork from "../../assets/scenes/idle-monitors/aquarium.png";
import windowSkyArtwork from "../../assets/scenes/idle-monitors/window-sky.png";

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
  const staticTheme = Math.round(offsetSeconds / 17) % 2 === 0 ? "aquarium" : "window";

  return (
    <span
      className={`scene-idle-monitor ${shouldReduceMotion ? `is-static-${staticTheme}` : ""}`}
      style={{ "--idle-monitor-offset": `${offsetSeconds}s` } as IdleMonitorStyle}
      role="img"
      aria-label="空闲屏保"
    >
      <img
        className="scene-idle-monitor-art scene-idle-monitor-art--aquarium"
        src={aquariumArtwork}
        alt=""
        draggable={false}
        aria-hidden="true"
      />
      <img
        className="scene-idle-monitor-art scene-idle-monitor-art--window"
        src={windowSkyArtwork}
        alt=""
        draggable={false}
        aria-hidden="true"
      />
    </span>
  );
};
