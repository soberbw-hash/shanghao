import type { PropsWithChildren } from "react";

import { cn } from "@private-voice/ui";

export const InlineBanner = ({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "warning" | "danger" | "success" }>) => (
  <div
    className={cn(
      "rounded-[16px] border px-4 py-3 text-sm",
      tone === "warning" && "border-amber-300/20 bg-amber-300/8 text-amber-100",
      tone === "danger" && "border-rose-300/20 bg-rose-300/8 text-rose-100",
      tone === "success" && "border-emerald-300/20 bg-emerald-300/8 text-emerald-100",
      tone === "neutral" && "border-white/8 bg-white/5 text-white/70",
    )}
  >
    {children}
  </div>
);
