import { Check } from "lucide-react";
import type { RoomIconColor } from "@private-voice/shared";
import { ROOM_ICON_COLORS, roomIconColors, roomIconStyle } from "./roomIconColors";

export const PrivateRoomColorPicker = ({
  value,
  disabled,
  onChange,
}: {
  value: RoomIconColor;
  disabled: boolean;
  onChange: (color: RoomIconColor) => void;
}) => (
  <fieldset disabled={disabled}>
    <legend className="mb-2 text-sm font-medium">图标颜色</legend>
    <div className="flex gap-3">
      {ROOM_ICON_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={roomIconColors[color].label}
          aria-pressed={value === color}
          title={roomIconColors[color].label}
          onClick={() => onChange(color)}
          style={roomIconStyle(color)}
          className="flex size-8 items-center justify-center rounded-full border border-current/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2"
        >
          {value === color ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <span className="size-3 rounded-full bg-current" />
          )}
        </button>
      ))}
    </div>
  </fieldset>
);
