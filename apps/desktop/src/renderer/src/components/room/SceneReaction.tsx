import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import type { SceneReaction as SceneReactionModel } from "@private-voice/shared";

import { motionSpring } from "../../features/motion/motionSystem";

export const SceneReaction = ({
  reactions,
  shouldReduceMotion,
}: {
  reactions: SceneReactionModel[];
  shouldReduceMotion: boolean;
}) => {
  const [visibleReactions, setVisibleReactions] = useState<SceneReactionModel[]>([]);

  useEffect(() => {
    const now = Date.now();
    setVisibleReactions((current) => {
      const merged = new Map(current.map((reaction) => [reaction.id, reaction]));
      reactions.forEach((reaction) => merged.set(reaction.id, reaction));
      return [...merged.values()]
        .filter((reaction) => now - Date.parse(reaction.createdAt) < 1_800)
        .slice(-3);
    });
    const timeout = window.setTimeout(() => {
      const expiresAt = Date.now();
      setVisibleReactions((current) =>
        current.filter((reaction) => expiresAt - Date.parse(reaction.createdAt) < 1_800),
      );
    }, 1_850);
    return () => window.clearTimeout(timeout);
  }, [reactions]);

  return (
    <div className="scene-character-reaction-stack" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {visibleReactions.map((reaction, index) => (
          <motion.div
            key={reaction.id}
            className={`scene-character-reaction reaction-${reaction.emoji}`}
            style={{ left: `${50 + (index - 1) * 22}%` }}
            initial={{
              opacity: 0,
              y: shouldReduceMotion ? 0 : 8,
              scale: shouldReduceMotion ? 1 : 0.72,
            }}
            animate={{ opacity: 1, y: shouldReduceMotion ? 0 : -6 - index * 4, scale: 1 }}
            exit={{
              opacity: 0,
              y: shouldReduceMotion ? 0 : -24,
              scale: shouldReduceMotion ? 1 : 0.82,
            }}
            transition={
              shouldReduceMotion ? { duration: 0.1 } : { type: "spring", ...motionSpring.soft }
            }
          >
            {reaction.emoji}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};
