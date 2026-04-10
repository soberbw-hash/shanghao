import { cn } from "./cn";

interface StatusPillProps {
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
  children: string;
}

const toneClasses = {
  neutral: "bg-white/8 text-white/70",
  success: "bg-emerald-400/15 text-emerald-200",
  warning: "bg-amber-400/15 text-amber-200",
  danger: "bg-rose-400/15 text-rose-200",
  accent: "bg-sky-400/15 text-sky-100"
} as const;

export const StatusPill = ({ tone = "neutral", children }: StatusPillProps) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium",
      toneClasses[tone]
    )}
  >
    {children}
  </span>
);
