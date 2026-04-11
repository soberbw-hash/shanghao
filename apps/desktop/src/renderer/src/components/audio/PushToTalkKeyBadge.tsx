import { Keyboard } from "lucide-react";

const formatShortcutLabel = (shortcut: string): string => {
  if (shortcut === "Space") {
    return "空格";
  }

  return shortcut;
};

export const PushToTalkKeyBadge = ({ shortcut }: { shortcut: string }) => (
  <div className="inline-flex items-center gap-2 rounded-[14px] border border-[#E7ECF2] bg-[#F8FAFC] px-3 py-2 text-sm text-[#667085]">
    <Keyboard className="h-4 w-4" />
    按键：{formatShortcutLabel(shortcut)}
  </div>
);
