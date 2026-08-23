import { useId } from "react";
import { LayoutGroup, motion } from "framer-motion";

import { APPLE_MOTION_SPRINGS } from "@private-voice/shared";

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

export const SegmentedControl = ({ value, options, onChange }: SegmentedControlProps) => {
  const groupId = useId();

  return (
    <LayoutGroup id={groupId}>
      <div className="inline-flex rounded-[14px] border border-[#E7ECF2] bg-[#F8FAFC] p-1">
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "relative isolate min-w-20 rounded-[10px] px-3 py-2 text-sm transition-colors",
                selected ? "text-[#111827]" : "text-[#667085] hover:text-[#111827]",
              )}
            >
              {selected ? (
                <motion.span
                  className="absolute inset-0 -z-[1] rounded-[10px] bg-white shadow-[0_4px_12px_rgba(17,24,39,0.06)]"
                  layoutId="segmented-control-active"
                  transition={{ type: "spring", ...APPLE_MOTION_SPRINGS.compact }}
                />
              ) : null}
              <span className="relative z-[1]">{option.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
};
