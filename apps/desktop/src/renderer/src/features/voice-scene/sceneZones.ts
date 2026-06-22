import type { MemberActivity, SceneZoneId } from "@private-voice/shared";

export interface SceneZone {
  id: SceneZoneId;
  label: string;
  activity: MemberActivity;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CharacterPosition {
  left: number;
  top: number;
  zIndex: number;
}

export const sceneZones: SceneZone[] = [
  { id: "coffeeBar", label: "茶水间", activity: "drinking", left: 14, top: 24, width: 11, height: 18 },
  { id: "fitnessZone", label: "运动区", activity: "fitness", left: 11, top: 67, width: 12, height: 18 },
  { id: "restroomZone", label: "洗手间", activity: "restroom", left: 85, top: 16, width: 12, height: 18 },
  { id: "gameDesk1", label: "游戏位 1", activity: "gaming", left: 33, top: 53, width: 12, height: 16 },
  { id: "gameDesk2", label: "游戏位 2", activity: "gaming", left: 50, top: 32, width: 12, height: 16 },
  { id: "gameDesk3", label: "游戏位 3", activity: "gaming", left: 68, top: 60, width: 12, height: 16 },
  { id: "gameDesk4", label: "游戏位 4", activity: "gaming", left: 42, top: 89, width: 13, height: 16 },
  { id: "gameDesk5", label: "游戏位 5", activity: "gaming", left: 86, top: 88, width: 13, height: 16 },
];

export const defaultMemberZones: SceneZoneId[] = [
  "gameDesk1",
  "gameDesk2",
  "gameDesk3",
  "gameDesk4",
  "gameDesk5",
];

export const characterPositions: Record<SceneZoneId, CharacterPosition> = {
  coffeeBar: { left: 14, top: 24, zIndex: 20 },
  fitnessZone: { left: 11, top: 67, zIndex: 30 },
  restroomZone: { left: 85, top: 16, zIndex: 20 },
  gameDesk1: { left: 33, top: 53, zIndex: 25 },
  gameDesk2: { left: 50, top: 32, zIndex: 22 },
  gameDesk3: { left: 68, top: 60, zIndex: 28 },
  gameDesk4: { left: 42, top: 89, zIndex: 32 },
  gameDesk5: { left: 86, top: 88, zIndex: 33 },
};
