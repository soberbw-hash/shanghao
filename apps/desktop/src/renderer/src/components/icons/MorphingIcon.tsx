import { forwardRef } from "react";

import { MorphIcon, type MorphHandle, type MorphIconProps } from "morphicons/react";

/**
 * ShangHao's shared morphing-icon surface.
 *
 * Keep the motion policy here so individual controls cannot accidentally
 * diverge on spring feel or reduced-motion behavior.
 */
export const MorphingIcon = forwardRef<MorphHandle, MorphIconProps>(
  ({ reducedMotion = "user", spring = "smooth", strokeWidth = 1.8, ...props }, ref) => (
    <MorphIcon
      ref={ref}
      reducedMotion={reducedMotion}
      spring={spring}
      strokeWidth={strokeWidth}
      {...props}
    />
  ),
);

MorphingIcon.displayName = "MorphingIcon";
