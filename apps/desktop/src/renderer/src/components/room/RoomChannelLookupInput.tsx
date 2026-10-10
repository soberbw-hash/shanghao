import { DigitCodeInput } from "../base/DigitCodeInput";
import { Button } from "../base/Button";

export const RoomChannelLookupInput = ({
  code,
  blocked,
  searching,
  onChange,
}: {
  code: string;
  blocked: boolean;
  searching: boolean;
  onChange: (value: string) => void;
}) => (
  <>
    <span className="block text-xs font-medium text-slate-500">频道号</span>
    <div className="flex gap-2">
      <DigitCodeInput
        autoFocus
        value={code}
        aria-label="查找频道号"
        disabled={blocked}
        status={searching ? "checking" : "idle"}
        statusLabel={searching ? "正在查找房间" : undefined}
        onValueChange={onChange}
      />
      <Button
        type="submit"
        variant="secondary"
        className="min-w-16 shrink-0 whitespace-nowrap"
        disabled={blocked || code.length !== 6}
      >
        查找
      </Button>
    </div>
  </>
);
