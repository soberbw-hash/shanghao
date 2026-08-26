import { motion, useReducedMotion } from "framer-motion";

import { cn } from "@private-voice/ui";

export const LiquidSelectionIndicator = ({
  layoutId,
  className,
}: {
  layoutId: string;
  className?: string;
}) => {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.span
      layoutId={layoutId}
      initial={false}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 520, damping: 34, mass: 0.62 }
      }
      className={cn(
        "liquid-selection-indicator pointer-events-none absolute inset-[3px] rounded-[inherit] bg-white shadow-[0_3px_10px_rgba(63,111,180,.1),inset_0_0_0_1px_rgba(151,192,239,.35)]",
        className,
      )}
      aria-hidden="true"
    />
  );
};
