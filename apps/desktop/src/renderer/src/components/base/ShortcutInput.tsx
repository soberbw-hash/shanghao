import { type KeyboardEvent, useMemo, useState } from "react";
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
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  defaultValue?: string;
  conflictMessage?: string;
}) => {
  const [isCapturing, setIsCapturing] = useState(false);

  const displayValue = useMemo(() => {
    if (isCapturing) {
      return "请直接按下快捷键";
    }

    return value;
  }, [isCapturing, value]);

  return (
    <div className="w-full space-y-2">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Keyboard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#98A2B3]" />
          <Input
            readOnly
            className="pl-10"
            value={displayValue}
            placeholder={placeholder}
            onFocus={() => setIsCapturing(true)}
            onBlur={() => setIsCapturing(false)}
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
        <Button variant="secondary" onClick={() => onChange("")}>
          清空
        </Button>
        {defaultValue ? (
          <Button variant="ghost" onClick={() => onChange(defaultValue)}>
            默认
          </Button>
        ) : null}
      </div>
      {conflictMessage ? <div className="text-xs text-[#DC2626]">{conflictMessage}</div> : null}
    </div>
  );
};
