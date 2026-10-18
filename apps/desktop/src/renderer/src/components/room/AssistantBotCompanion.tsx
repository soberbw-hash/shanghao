import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion, useSpring } from "framer-motion";
import type { AssistantBotMood } from "../../features/ai/useAssistantBotState";
import { mascotImages } from "./AssistantBotAvatar";
import { RoomAiIcon } from "./RoomAiIcon";

/** Only explicit pointer interaction adds playfulness; request state always takes priority. */
export const AssistantBotCompanion = ({
  mood,
  active,
}: {
  mood: AssistantBotMood;
  active: boolean;
}) => {
  const reduced = useReducedMotion();
  const [greeting, setGreeting] = useState(false);
  const [failed, setFailed] = useState<string>();
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const timer = useRef<number | undefined>(undefined);
  const rotateX = useSpring(0, { stiffness: 210, damping: 25 });
  const rotateY = useSpring(0, { stiffness: 210, damping: 25 });
  const scale = useSpring(1, { stiffness: 270, damping: 20 });
  const displayedMood = mood === "idle" && greeting ? "greeting" : mood;
  const source = mascotImages[displayedMood];
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (active && visible) return;
    rotateX.set(0);
    rotateY.set(0);
    scale.set(1);
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setGreeting(false), 280);
  }, [active, visible, rotateX, rotateY, scale]);
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (!active) return;
    for (const src of new Set(Object.values(mascotImages))) {
      const image = new Image();
      image.src = src;
      void image.decode().catch(() => undefined);
    }
  }, [active]);
  return (
    <motion.button
      type="button"
      className="assistant-bot-companion"
      aria-label="和小助手打个招呼"
      title="摸摸小助手"
      data-active={active && visible}
      data-mood={displayedMood}
      style={{
        rotateX: reduced ? 0 : rotateX,
        rotateY: reduced ? 0 : rotateY,
        scale: reduced ? 1 : scale,
      }}
      onPointerMove={(event) => {
        if (reduced || !active || !visible || event.pointerType === "touch") return;
        const rect = event.currentTarget.getBoundingClientRect();
        rotateX.set((0.5 - (event.clientY - rect.top) / rect.height) * 8);
        rotateY.set(((event.clientX - rect.left) / rect.width - 0.5) * 10);
      }}
      onPointerLeave={() => {
        rotateX.set(0);
        rotateY.set(0);
      }}
      onClick={() => {
        if (timer.current !== undefined) window.clearTimeout(timer.current);
        setGreeting(true);
        if (!reduced) scale.set(1.07);
        timer.current = window.setTimeout(() => {
          setGreeting(false);
          scale.set(1);
        }, 1100);
      }}
    >
      <span className="assistant-bot-companion-float">
        {failed === source ? (
          <RoomAiIcon />
        ) : (
          <AnimatePresence initial={false}>
            <motion.img
              key={source}
              src={source}
              alt=""
              aria-hidden="true"
              draggable={false}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduced ? 0 : 0.2 }}
              onError={() => setFailed(source)}
            />
          </AnimatePresence>
        )}
      </span>
    </motion.button>
  );
};
