import { cn } from "./cn";

interface StatusPillProps {
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
  children: string;
}

const toneClasses = {
  neutral: "bg-[#F2F4F7] text-[#667085]",
  success: "bg-[#ECFDF3] text-[#15803D]",
  warning: "bg-[#FFFAEB] text-[#B45309]",
  danger: "bg-[#FEF3F2] text-[#B42318]",
  accent: "bg-[#EEF6FF] text-[#2B84E9]",
} as const;

export const StatusPill = ({ tone = "neutral", children }: StatusPillProps) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium",
      toneClasses[tone],
    )}
  >
    {children}
  </span>
);
