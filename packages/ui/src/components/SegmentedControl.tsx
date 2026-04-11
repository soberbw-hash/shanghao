import { cn } from "./cn";

export interface SegmentedControlOption {
  value: string;
  label: string;
}

interface SegmentedControlProps {
  value: string;
  options: SegmentedControlOption[];
  onChange: (value: string) => void;
}

export const SegmentedControl = ({
  value,
  options,
  onChange,
}: SegmentedControlProps) => (
  <div className="inline-flex rounded-[14px] border border-[#E7ECF2] bg-[#F8FAFC] p-1">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        className={cn(
          "min-w-20 rounded-[10px] px-3 py-2 text-sm transition-colors",
          value === option.value
            ? "bg-white text-[#111827] shadow-[0_4px_12px_rgba(17,24,39,0.06)]"
            : "text-[#667085] hover:text-[#111827]",
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);
