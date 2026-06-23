import type { MemberActivity, SceneZoneId } from "@private-voice/shared";

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
  { id: "gameDesk1", label: "1 号位", shortLabel: "1", kind: "seat", activity: "gaming", left: 44, top: 32, width: 14, height: 15 },
  { id: "gameDesk2", label: "2 号位", shortLabel: "2", kind: "seat", activity: "gaming", left: 70, top: 32, width: 14, height: 15 },
  { id: "gameDesk3", label: "3 号位", shortLabel: "3", kind: "seat", activity: "gaming", left: 44, top: 58, width: 14, height: 15 },
  { id: "gameDesk4", label: "4 号位", shortLabel: "4", kind: "seat", activity: "gaming", left: 70, top: 58, width: 14, height: 15 },
  { id: "gameDesk5", label: "5 号位", shortLabel: "5", kind: "seat", activity: "gaming", left: 57, top: 82, width: 14, height: 15 },
];

export const activityZones: SceneZone[] = [
  { id: "coffeeBar", label: "茶水间", kind: "activity", activity: "drinking", left: 14, top: 24, width: 11, height: 18 },
  { id: "fitnessZone", label: "运动区", kind: "activity", activity: "fitness", left: 11, top: 67, width: 12, height: 18 },
  { id: "restroomZone", label: "离开一下", kind: "activity", activity: "restroom", left: 85, top: 16, width: 12, height: 18 },
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

export const characterPositions: Record<SceneZoneId, CharacterPosition> = {
  coffeeBar: { left: 14, top: 25, zIndex: 20, scale: 0.9 },
  fitnessZone: { left: 11, top: 68, zIndex: 30, scale: 1.04 },
  restroomZone: { left: 85, top: 17, zIndex: 20, scale: 0.82 },
  gameDesk1: { left: 44, top: 35, zIndex: 24, scale: 0.92 },
  gameDesk2: { left: 70, top: 35, zIndex: 25, scale: 0.92 },
  gameDesk3: { left: 44, top: 61, zIndex: 31, scale: 1 },
  gameDesk4: { left: 70, top: 61, zIndex: 32, scale: 1 },
  gameDesk5: { left: 57, top: 84, zIndex: 37, scale: 1.02, labelOffsetY: -5 },
};
