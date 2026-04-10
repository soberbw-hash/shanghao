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
      "relative inline-flex h-7 w-12 items-center rounded-full transition-colors",
      isChecked ? "bg-sky-300/70" : "bg-white/10"
    )}
    aria-pressed={isChecked}
  >
    <span
      className={cn(
        "absolute left-1 h-5 w-5 rounded-full bg-white transition-transform",
        isChecked && "translate-x-5"
      )}
    />
  </button>
);
