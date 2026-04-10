import { Keyboard } from "lucide-react";

import { Input } from "./Input";

export const ShortcutInput = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) => (
  <div className="relative">
    <Keyboard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
    <Input className="pl-10" value={value} onChange={(event) => onChange(event.target.value)} />
  </div>
);
