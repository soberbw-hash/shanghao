import { Check } from "lucide-react";
import { cn } from "@private-voice/ui";
import { ROOM_ICON_IDS, type RoomIconId } from "@private-voice/shared";
import { PrivateRoomIcon, roomIconLabels } from "./PrivateRoomIcon";

/** Presentational selection only; room persistence stays with the editor. */
export const PrivateRoomIconPicker = ({
  value,
  disabled,
  onChange,
}: {
  value: RoomIconId;
  disabled: boolean;
  onChange: (value: RoomIconId) => void;
}) => (
  <fieldset disabled={disabled}>
    <legend className="mb-2 text-sm font-medium">房间图标</legend>
    <div className="grid grid-cols-5 gap-2">
      {ROOM_ICON_IDS.map((id) => (
        <button
          key={id}
          type="button"
          aria-label={roomIconLabels[id]}
          aria-pressed={value === id}
          title={roomIconLabels[id]}
          onClick={() => onChange(id)}
          className={cn(
            "relative flex h-11 items-center justify-center rounded-xl border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed",
            value === id
              ? "border-blue-300 bg-blue-50 text-blue-600"
              : "border-slate-200 bg-white/60 text-slate-500 hover:border-blue-200 hover:text-blue-600",
          )}
        >
          <PrivateRoomIcon icon={id} />
          {value === id && <Check className="absolute right-1 top-1 size-3" aria-hidden="true" />}
        </button>
      ))}
    </div>
  </fieldset>
);
