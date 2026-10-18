import type { RoomMember } from "@private-voice/shared";

export type MemberAvailability = NonNullable<RoomMember["availabilityStatus"]>;
export const availabilityLabels: Record<MemberAvailability, string> = {
  away: "暂时离开",
  eating: "吃饭中",
  restroom: "去厕所",
};
const PREFIX = "shanghao-status:v1:";
// Use the existing room-scoped control transport, just like quick-message
// controls. Older relays forward it safely and older clients ignore the target.
export const encodeMemberAvailability = (status?: MemberAvailability): string =>
  `${PREFIX}${status ?? "available"}`;
export const decodeMemberAvailability = (
  target: string,
): MemberAvailability | "available" | undefined => {
  if (!target.startsWith(PREFIX)) return undefined;
  const value = target.slice(PREFIX.length);
  return value === "available" || Object.hasOwn(availabilityLabels, value)
    ? (value as MemberAvailability | "available")
    : undefined;
};
