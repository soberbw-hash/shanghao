import { Keyboard } from "lucide-react";

import { Input } from "./Input";

export const ShortcutInput = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => (
  <div className="relative w-full">
    <Keyboard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98A2B3]" />
    <Input
      className="pl-10"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  </div>
);
