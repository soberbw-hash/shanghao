import { Keyboard } from "lucide-react";

export const PushToTalkKeyBadge = ({ shortcut }: { shortcut: string }) => (
  <div className="inline-flex items-center gap-2 rounded-[14px] border border-white/8 bg-white/5 px-3 py-2 text-sm text-white/65">
    <Keyboard className="h-4 w-4" />
    {shortcut}
  </div>
);
