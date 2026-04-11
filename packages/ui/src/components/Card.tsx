import type { HTMLAttributes, PropsWithChildren } from "react";

import { cn } from "./cn";

export const Card = ({
  children,
  className,
  ...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) => (
  <div
    className={cn(
      "rounded-[16px] border border-[#E7ECF2] bg-white p-4 shadow-[0_10px_30px_rgba(17,24,39,0.05)]",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
