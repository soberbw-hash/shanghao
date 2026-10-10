import { Shuffle } from "lucide-react";
import { Button } from "../base/Button";
import { DigitCodeInput } from "../base/DigitCodeInput";

/** Creation-only presentation; availability requests remain owned by the editor. */
export const RoomChannelCodeField = ({
  code,
  disabled,
  checking,
  availability,
  onChange,
  onShuffle,
}: {
  code: string;
  disabled: boolean;
  checking: boolean;
  availability?: string;
  onChange: (value: string) => void;
  onShuffle: () => void;
}) => (
  <label className="block space-y-2 text-sm font-medium">
    频道号
    <div className="flex gap-2">
      <DigitCodeInput
        value={code}
        aria-label="频道号"
        disabled={disabled}
        status={
          checking
            ? "checking"
            : availability === "可用"
              ? "success"
              : availability
                ? "error"
                : "idle"
        }
        statusLabel={checking ? "检查频道号" : availability}
        onValueChange={onChange}
      />
      <Button
        type="button"
        variant="secondary"
        onClick={onShuffle}
        disabled={disabled}
        aria-label="随机可用频道号"
      >
        <Shuffle className="size-4" />
      </Button>
    </div>
    <span className="block text-xs text-slate-500" role="status">
      {checking ? "检查中…" : (availability ?? "六位数字，可保留开头的 0")}
    </span>
  </label>
);
