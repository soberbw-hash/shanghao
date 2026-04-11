import type { PropsWithChildren } from "react";

import { cn } from "@private-voice/ui";

export const InlineBanner = ({
  children,
  tone = "neutral",
}: PropsWithChildren<{ tone?: "neutral" | "warning" | "danger" | "success" }>) => (
  <div
    className={cn(
      "rounded-[16px] border px-4 py-3 text-sm",
      tone === "warning" && "border-[#FDE7B0] bg-[#FFFAEB] text-[#B45309]",
      tone === "danger" && "border-[#F9D3D0] bg-[#FEF3F2] text-[#B42318]",
      tone === "success" && "border-[#C7E8D2] bg-[#ECFDF3] text-[#15803D]",
      tone === "neutral" && "border-[#E7ECF2] bg-[#F8FAFC] text-[#667085]",
    )}
  >
    {children}
  </div>
);
