import { useEffect, useRef, useState } from "react";
import doorAsset from "../../assets/scenes/shanghao-room/door.png";
import "./SceneWelcomeDoor.css";

export const SceneWelcomeDoor = ({
  memberKeys,
  motionEnabled,
  className = "",
}: {
  memberKeys: string;
  motionEnabled: boolean;
  className?: string;
}) => {
  const previousKeys = useRef<string | undefined>(undefined);
  const openUntil = useRef(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // Stable scene identities ignore transport reconnects, seat changes and away status.
    const previous = previousKeys.current;
    previousKeys.current = memberKeys;
    if (previous !== memberKeys && (previous !== undefined || memberKeys)) {
      openUntil.current = performance.now() + 3_000;
    }
    if (!motionEnabled) openUntil.current = 0;
    const remaining = openUntil.current - performance.now();
    setOpen(remaining > 0);
    if (remaining <= 0) return;
    // Re-schedule the remaining interval after StrictMode's effect cleanup.
    const timer = window.setTimeout(() => setOpen(false), remaining);
    return () => window.clearTimeout(timer);
  }, [memberKeys, motionEnabled]);

  return (
    <div
      className={`scene-service-zone scene-service-restroom scene-welcome-door ${open ? "is-open" : ""} ${className}`}
      aria-hidden="true"
    >
      <div className="scene-welcome-door-art">
        <img src={doorAsset} alt="" draggable={false} />
        <div className="scene-welcome-door-hall" />
        <img className="scene-welcome-door-panel" src={doorAsset} alt="" draggable={false} />
      </div>
    </div>
  );
};
