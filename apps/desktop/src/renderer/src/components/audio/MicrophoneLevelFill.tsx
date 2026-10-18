import { useEffect, useRef } from "react";
import { REMOTE_AUDIO_LEVEL_EVENT } from "../../features/audio/RemoteAudioMixer";

/** Consume the existing local meter; this visual never opens or changes a microphone. */
export const MicrophoneLevelFill = ({ muted }: { muted: boolean }) => {
  const fill = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const paint = (level: number) => {
      if (!fill.current) return;
      const visible = document.visibilityState === "visible";
      const value =
        muted || !visible || !Number.isFinite(level) ? 0 : Math.min(1, Math.max(0, level));
      fill.current.style.transform = `translateY(${100 - Math.sqrt(value) * 100}%)`;
      fill.current.dataset.active = String(value > 0.005);
    };
    const onLevel = (event: Event) => {
      const detail = (event as CustomEvent<{ peerId?: string; level: number }>).detail;
      if (detail?.peerId === "local-member") paint(detail.level);
    };
    const hide = () => paint(0);
    paint(0);
    window.addEventListener(REMOTE_AUDIO_LEVEL_EVENT, onLevel);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener(REMOTE_AUDIO_LEVEL_EVENT, onLevel);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [muted]);
  return <span ref={fill} className="microphone-level-fill" aria-hidden="true" />;
};
