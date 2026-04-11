import { Volume2 } from "lucide-react";

import { Slider } from "../base/Slider";

export const MemberVolumePopover = ({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) => (
  <div className="flex items-center gap-3 rounded-[14px] border border-[#E7ECF2] bg-[#F8FAFC] px-3 py-2">
    <Volume2 className="h-4 w-4 text-[#667085]" />
    <Slider
      min={0}
      max={1}
      step={0.01}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  </div>
);
