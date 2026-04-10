import type { HTMLAttributes, PropsWithChildren } from "react";

import { cn } from "@private-voice/ui";

export const GlassPanel = ({
  children,
  className,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) => (
  <div
    className={cn(
      "rounded-[20px] border border-white/8 bg-[rgba(18,24,34,0.8)] shadow-panel backdrop-blur-panel",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
