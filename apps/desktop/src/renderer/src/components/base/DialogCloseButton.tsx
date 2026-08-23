import { X } from "lucide-react";

export const DialogCloseButton = ({
  label = "关闭弹窗",
  onClick,
  disabled = false,
  className = "",
}: {
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    disabled={disabled}
    onClick={onClick}
    className={`grid size-11 shrink-0 place-items-center rounded-[14px] border border-[#d7e4f3] bg-white/82 text-[#718096] shadow-sm transition-colors hover:bg-white hover:text-[#26364d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4a8de8]/45 disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
  >
    <X className="size-5" aria-hidden="true" />
  </button>
);
