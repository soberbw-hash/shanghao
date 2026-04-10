import type { SelectHTMLAttributes } from "react";

import { cn } from "./cn";

export const Select = ({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    className={cn(
      "h-11 w-full rounded-[14px] border border-white/10 bg-white/6 px-3 text-sm text-white outline-none transition focus:border-sky-300/40 focus:bg-white/8",
      className
    )}
    {...props}
  >
    {children}
  </select>
);
