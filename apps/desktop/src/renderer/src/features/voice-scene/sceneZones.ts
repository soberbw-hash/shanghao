import type { MemberActivity, RoomMember, SceneZoneId } from "@private-voice/shared";

export interface SceneZone {
  id: SceneZoneId;
  label: string;
  activity: MemberActivity;
  kind: "seat" | "activity";
  shortLabel?: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CharacterPosition {
  left: number;
  top: number;
  zIndex: number;
  scale: number;
  labelOffsetY?: number;
}

export const seatSlots: SceneZone[] = [
  {
    id: "gameDesk1",
    label: "1 号位",
    shortLabel: "1",
    kind: "seat",
    activity: "idle",
    left: 30,
    top: 31,
    width: 18,
    height: 22,
  },
  {
    id: "gameDesk2",
    label: "2 号位",
    shortLabel: "2",
    kind: "seat",
    activity: "idle",
    left: 52,
    top: 31,
    width: 18,
    height: 22,
  },
  {
    id: "gameDesk3",
    label: "3 号位",
    shortLabel: "3",
    kind: "seat",
    activity: "idle",
    left: 74,
    top: 31,
    width: 18,
    height: 22,
  },
  {
    id: "gameDesk4",
    label: "4 号位",
    shortLabel: "4",
    kind: "seat",
    activity: "idle",
    left: 40,
    top: 67,
    width: 18,
    height: 22,
  },
  {
    id: "gameDesk5",
    label: "5 号位",
    shortLabel: "5",
    kind: "seat",
    activity: "idle",
    left: 65,
    top: 67,
    width: 18,
    height: 22,
  },
];

export const activityZones: SceneZone[] = [
  {
    id: "restroomZone",
    label: "离开一下",
    kind: "activity",
    activity: "restroom",
    left: 12,
    top: 80,
    width: 20,
    height: 25,
  },
];

export const sceneZones: SceneZone[] = [...seatSlots, ...activityZones];

export const defaultMemberZones: SceneZoneId[] = [
  "gameDesk1",
  "gameDesk2",
  "gameDesk3",
  "gameDesk4",
  "gameDesk5",
];

export const isSeatZone = (zone: SceneZoneId): boolean => zone.startsWith("gameDesk");

export const resolveMemberSceneZones = (
  members: Pick<RoomMember, "id" | "joinedAt" | "sceneZone">[],
): Map<string, SceneZoneId> => {
  const result = new Map<string, SceneZoneId>();
  const occupiedSeats = new Set<SceneZoneId>();
  const orderedMembers = [...members].sort(
    (left, right) => left.joinedAt.localeCompare(right.joinedAt) || left.id.localeCompare(right.id),
  );

  orderedMembers.forEach((member) => {
    const requestedZone = member.sceneZone;
    if (requestedZone && !isSeatZone(requestedZone)) {
      result.set(member.id, requestedZone);
      return;
    }

    const resolvedZone =
      requestedZone && !occupiedSeats.has(requestedZone)
        ? requestedZone
        : (defaultMemberZones.find((zone) => !occupiedSeats.has(zone)) ?? "restroomZone");
    result.set(member.id, resolvedZone);
    if (isSeatZone(resolvedZone)) {
      occupiedSeats.add(resolvedZone);
    }
  });

  return result;
};

export const characterPositions: Record<SceneZoneId, CharacterPosition> = {
  restroomZone: { left: 12, top: 65, zIndex: 38, scale: 0.42 },
  gameDesk1: { left: 30, top: 38, zIndex: 24, scale: 0.86 },
  gameDesk2: { left: 52, top: 38, zIndex: 25, scale: 0.86 },
  gameDesk3: { left: 74, top: 38, zIndex: 26, scale: 0.86 },
  gameDesk4: { left: 40, top: 74, zIndex: 34, scale: 0.94 },
  gameDesk5: { left: 65, top: 74, zIndex: 35, scale: 0.94 },
};
