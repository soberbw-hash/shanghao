import { AnimatePresence, motion } from "framer-motion";

import type { SceneReaction as SceneReactionModel } from "@private-voice/shared";

import { motionSpring } from "../../features/motion/motionSystem";

export const SceneReaction = ({
  reaction,
  shouldReduceMotion,
}: {
  reaction?: SceneReactionModel;
  shouldReduceMotion: boolean;
}) => (
  <AnimatePresence mode="popLayout">
    {reaction ? (
      <motion.div
        key={reaction.id}
        className="scene-character-reaction"
        initial={{
          opacity: 0,
          y: shouldReduceMotion ? 0 : 8,
          scale: shouldReduceMotion ? 1 : 0.72,
        }}
        animate={{ opacity: 1, y: shouldReduceMotion ? 0 : -6, scale: 1 }}
        exit={{ opacity: 0, y: shouldReduceMotion ? 0 : -24, scale: shouldReduceMotion ? 1 : 0.82 }}
        transition={
          shouldReduceMotion ? { duration: 0.1 } : { type: "spring", ...motionSpring.soft }
        }
      >
        {reaction.emoji}
      </motion.div>
    ) : null}
  </AnimatePresence>
);
