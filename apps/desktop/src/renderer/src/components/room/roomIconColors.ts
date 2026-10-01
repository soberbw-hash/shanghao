import type { CSSProperties } from "react";
import { ROOM_ICON_COLORS, type RoomIconColor } from "@private-voice/shared";

export const roomIconColors: Record<
  RoomIconColor,
  { label: string; ink: string; surface: string }
> = {
  blue: { label: "晴空蓝", ink: "#397ac6", surface: "#eaf3ff" },
  teal: { label: "薄荷绿", ink: "#278277", surface: "#e8f5f0" },
  amber: { label: "暖阳橙", ink: "#aa7627", surface: "#fff4e1" },
  rose: { label: "柔和红", ink: "#b36176", surface: "#fbeef2" },
  slate: { label: "雾灰", ink: "#64748b", surface: "#edf1f6" },
};
export const roomIconStyle = (color: RoomIconColor = "blue"): CSSProperties => ({
  color: roomIconColors[color].ink,
  backgroundColor: roomIconColors[color].surface,
});
export { ROOM_ICON_COLORS };
