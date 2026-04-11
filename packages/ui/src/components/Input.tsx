import type { InputHTMLAttributes } from "react";

import { cn } from "./cn";

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={cn(
      "h-11 w-full rounded-[14px] border border-[#E7ECF2] bg-white px-3 text-sm text-[#111827] outline-none transition",
      "placeholder:text-[#98A2B3] focus:border-[#4DA3FF] focus:bg-white focus:ring-4 focus:ring-[#4DA3FF]/10",
      className,
    )}
    {...props}
  />
);
