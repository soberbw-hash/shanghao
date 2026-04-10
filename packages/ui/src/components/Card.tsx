import type { HTMLAttributes, PropsWithChildren } from "react";

import { cn } from "./cn";

export const Card = ({
  children,
  className,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) => (
  <div
    className={cn(
      "rounded-[16px] border border-white/8 bg-[rgba(255,255,255,0.05)] p-4 shadow-[0_18px_50px_rgba(0,0,0,0.2)] backdrop-blur-xl",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
