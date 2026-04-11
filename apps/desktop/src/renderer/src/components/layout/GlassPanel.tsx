import type { HTMLAttributes, PropsWithChildren } from "react";

import { cn } from "@private-voice/ui";

export const GlassPanel = ({
  children,
  className,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) => (
  <div
    className={cn(
      "rounded-[20px] border border-[#E7ECF2] bg-white shadow-[0_12px_30px_rgba(17,24,39,0.06)]",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
