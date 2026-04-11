import type { SelectHTMLAttributes } from "react";

import { cn } from "./cn";

export const Select = ({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    className={cn(
      "h-11 w-full rounded-[14px] border border-[#E7ECF2] bg-white px-3 text-sm text-[#111827] outline-none transition",
      "focus:border-[#4DA3FF] focus:ring-4 focus:ring-[#4DA3FF]/10",
      className,
    )}
    {...props}
  >
    {children}
  </select>
);
