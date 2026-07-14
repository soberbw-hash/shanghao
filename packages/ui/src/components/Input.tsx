import type { InputHTMLAttributes } from "react";

import { cn } from "./cn";

export const Input = ({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={cn(
      "h-11 w-full rounded-[13px] border border-[#DCE5F0] bg-white/95 px-3 text-sm text-[#111827] shadow-[inset_0_1px_2px_rgba(70,95,130,.045)] outline-none transition-[border-color,background-color,box-shadow,color] duration-150",
      "placeholder:text-[#98A2B3] focus:border-[#6DAFF5] focus:bg-white focus:ring-4 focus:ring-[#4DA3FF]/10",
      className,
    )}
    {...props}
  />
);
