import { cn } from "./cn";

interface SwitchProps {
  isChecked: boolean;
  onChange: (nextValue: boolean) => void;
}

export const Switch = ({ isChecked, onChange }: SwitchProps) => (
  <button
    type="button"
    onClick={() => onChange(!isChecked)}
    className={cn(
      "relative inline-flex h-7 w-12 items-center rounded-full border transition-colors",
      isChecked
        ? "border-[#4DA3FF] bg-[#4DA3FF]"
        : "border-[#D6DEE8] bg-[#E7ECF2]",
    )}
    aria-pressed={isChecked}
  >
    <span
      className={cn(
        "absolute left-1 h-5 w-5 rounded-full bg-white shadow-[0_2px_6px_rgba(17,24,39,0.16)] transition-transform",
        isChecked && "translate-x-5",
      )}
    />
  </button>
);
