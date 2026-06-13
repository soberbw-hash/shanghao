import type { HTMLAttributes, PropsWithChildren } from "react";

import { cn } from "@private-voice/ui";

export const GlassPanel = ({
  children,
  className,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) => (
  <div
    className={cn(
      "glass-panel rounded-[20px]",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
