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
      "relative inline-flex h-7 w-12 items-center rounded-full border shadow-[inset_0_1px_1px_rgba(30,45,70,.08),0_2px_8px_rgba(63,102,160,.08)] backdrop-blur-xl transition-[background-color,border-color,box-shadow,opacity] duration-150",
      isChecked
        ? "border-white/55 bg-[linear-gradient(180deg,#62b3ff,#3d8fee)]"
        : "border-white/70 bg-[linear-gradient(180deg,rgba(239,244,250,.92),rgba(219,228,240,.78))]",
    )}
    aria-pressed={isChecked}
  >
    <span
      className={cn(
        "absolute left-1 h-5 w-5 rounded-full border border-white bg-[linear-gradient(180deg,#fff,#f3f7fb)] shadow-[0_3px_8px_rgba(17,24,39,0.2),inset_0_1px_0_white] transition-transform duration-200",
        isChecked && "translate-x-5",
      )}
    />
  </button>
);
