import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

export type AssistantBotMood = "idle" | "greeting" | "thinking" | "speaking" | "gaming" | "error";

const timedMoodMs: Partial<Record<AssistantBotMood, number>> = {
  greeting: 1_600,
  gaming: 2_200,
  error: 2_400,
};

/** One room-scoped mascot state, driven by real assistant actions. */
export const useAssistantBotState = (
  roomId: string,
  setAskOpen: Dispatch<SetStateAction<boolean>>,
) => {
  const [mood, setMood] = useState<AssistantBotMood>("idle");
  const restoreTimer = useRef<number | undefined>(undefined);

  const transition = useCallback((next: AssistantBotMood) => {
    if (restoreTimer.current !== undefined) {
      window.clearTimeout(restoreTimer.current);
      restoreTimer.current = undefined;
    }
    setMood(next);
    const duration = timedMoodMs[next];
    if (duration) {
      restoreTimer.current = window.setTimeout(() => {
        restoreTimer.current = undefined;
        setMood("idle");
      }, duration);
    }
  }, []);

  useEffect(
    () => () => {
      if (restoreTimer.current !== undefined) window.clearTimeout(restoreTimer.current);
    },
    [],
  );

  useEffect(() => {
    transition("idle");
    setAskOpen(false);
  }, [roomId, setAskOpen, transition]);

  useEffect(() => {
    const openAssistant = () => {
      transition("idle");
      setAskOpen(true);
    };
    window.addEventListener("shanghao:open-room-ai", openAssistant);
    return () => window.removeEventListener("shanghao:open-room-ai", openAssistant);
  }, [setAskOpen, transition]);

  return { mood, transition };
};
