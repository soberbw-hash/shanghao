import { type KeyboardEvent, type MouseEvent as ReactMouseEvent, useMemo, useState } from "react";
import { Keyboard } from "lucide-react";

import { Button } from "./Button";
import { Input } from "./Input";

const modifierLabels: Record<string, string> = {
  Control: "Ctrl",
  Meta: "Meta",
  Shift: "Shift",
  Alt: "Alt",
};

const ignoredKeys = new Set(["Tab"]);

const mouseShortcutNames: Record<number, string> = {
  3: "Mouse4",
  4: "Mouse5",
};

export const formatShortcutForDisplay = (value: string): string =>
  value
    .split("+")
    .map((part) => {
      const normalized = part.trim();
      if (normalized === "CommandOrControl" || normalized === "Control") return "Ctrl";
      if (normalized === "Meta" || normalized === "Super") return "Win";
      return normalized;
    })
    .filter(Boolean)
    .join(" + ");

const normalizeKey = (event: KeyboardEvent<HTMLInputElement>) => {
  const modifiers = [
    event.ctrlKey ? "Ctrl" : "",
    event.metaKey ? "Meta" : "",
    event.shiftKey ? "Shift" : "",
    event.altKey ? "Alt" : "",
  ].filter(Boolean);

  if (Object.prototype.hasOwnProperty.call(modifierLabels, event.key)) {
    return modifiers.join("+");
  }

  const key =
    event.code && event.code.startsWith("Key")
      ? event.code.replace("Key", "")
      : event.code && event.code.startsWith("Digit")
        ? event.code.replace("Digit", "")
        : event.key.length === 1
          ? event.key.toUpperCase()
          : event.code || event.key;

  return [...modifiers, key].filter(Boolean).join("+");
};

export const ShortcutInput = ({
  value,
  onChange,
  placeholder = "点击后按下快捷键",
  defaultValue,
  conflictMessage,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  defaultValue?: string;
  conflictMessage?: string;
  compact?: boolean;
}) => {
  const [isCapturing, setIsCapturing] = useState(false);

  const displayValue = useMemo(() => {
    if (isCapturing) {
      return "请按下键盘按键或鼠标侧键";
    }

    return formatShortcutForDisplay(value);
  }, [isCapturing, value]);

  return (
    <div
      className={`shortcut-input-wrap w-full ${
        compact ? "shortcut-input-wrap-compact space-y-1" : "space-y-2"
      }`}
    >
      <div className={`flex items-center ${compact ? "gap-2" : "gap-3"}`}>
        <div className="relative flex-1">
          <Keyboard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98A2B3]" />
          <Input
            readOnly
            className={`shortcut-input-field ${
              compact ? "shortcut-input-field-compact h-9 min-w-0 pl-8 pr-1" : "pl-10"
            }`}
            value={displayValue}
            title={displayValue}
            placeholder={placeholder}
            onFocus={() => setIsCapturing(true)}
            onBlur={() => setIsCapturing(false)}
            onMouseDown={(event: ReactMouseEvent<HTMLInputElement>) => {
              const mouseShortcut = mouseShortcutNames[event.button];
              if (!isCapturing || !mouseShortcut) return;
              event.preventDefault();
              event.stopPropagation();
              const modifiers = [
                event.ctrlKey ? "Ctrl" : "",
                event.metaKey ? "Meta" : "",
                event.shiftKey ? "Shift" : "",
                event.altKey ? "Alt" : "",
              ].filter(Boolean);
              onChange([...modifiers, mouseShortcut].join("+"));
              setIsCapturing(false);
            }}
            onKeyDown={(event) => {
              event.preventDefault();
              event.stopPropagation();

              if (ignoredKeys.has(event.key)) {
                return;
              }

              if (event.key === "Escape") {
                setIsCapturing(false);
                return;
              }

              if (event.key === "Backspace" || event.key === "Delete") {
                onChange("");
                setIsCapturing(false);
                return;
              }

              const nextValue = normalizeKey(event);
              if (!nextValue) {
                return;
              }

              onChange(nextValue);
              setIsCapturing(false);
            }}
          />
        </div>
        <Button
          variant="secondary"
          className={
            compact ? "h-9 shrink-0 whitespace-nowrap rounded-[10px] px-2.5 text-xs" : undefined
          }
          onClick={() => onChange("")}
        >
          清空
        </Button>
        {defaultValue ? (
          <Button
            variant="ghost"
            className={
              compact ? "h-9 shrink-0 whitespace-nowrap rounded-[10px] px-2 text-xs" : undefined
            }
            onClick={() => onChange(defaultValue)}
          >
            默认
          </Button>
        ) : null}
      </div>
      {conflictMessage ? <div className="text-xs text-[#DC2626]">{conflictMessage}</div> : null}
    </div>
  );
};
