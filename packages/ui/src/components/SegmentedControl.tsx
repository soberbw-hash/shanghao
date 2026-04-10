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
  onChange
}: SegmentedControlProps) => (
  <div className="inline-flex rounded-[14px] border border-white/10 bg-white/5 p-1">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        className={cn(
          "min-w-20 rounded-[10px] px-3 py-2 text-sm transition-colors",
          value === option.value
            ? "bg-white/12 text-white"
            : "text-white/55 hover:text-white/80"
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);
