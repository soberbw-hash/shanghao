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
  { id: "coffeeBar", label: "茶水间", activity: "drinking", left: 22, top: 18, width: 26, height: 18 },
  { id: "fitnessZone", label: "运动区", activity: "fitness", left: 12, top: 66, width: 22, height: 31 },
  { id: "restroomZone", label: "洗手间", activity: "restroom", left: 84, top: 18, width: 16, height: 24 },
  { id: "gameDesk1", label: "游戏位 1", activity: "gaming", left: 37, top: 43, width: 17, height: 20 },
  { id: "gameDesk2", label: "游戏位 2", activity: "gaming", left: 55, top: 29, width: 16, height: 18 },
  { id: "gameDesk3", label: "游戏位 3", activity: "gaming", left: 70, top: 50, width: 17, height: 20 },
  { id: "gameDesk4", label: "游戏位 4", activity: "gaming", left: 47, top: 73, width: 17, height: 20 },
  { id: "gameDesk5", label: "游戏位 5", activity: "gaming", left: 72, top: 76, width: 17, height: 20 },
];

export const defaultMemberZones: SceneZoneId[] = [
  "gameDesk1",
  "gameDesk2",
  "gameDesk3",
  "gameDesk4",
  "gameDesk5",
];

export const characterPositions: Record<SceneZoneId, CharacterPosition> = {
  coffeeBar: { left: 24, top: 24, zIndex: 20 },
  fitnessZone: { left: 15, top: 70, zIndex: 30 },
  restroomZone: { left: 84, top: 25, zIndex: 20 },
  gameDesk1: { left: 37, top: 48, zIndex: 25 },
  gameDesk2: { left: 55, top: 35, zIndex: 22 },
  gameDesk3: { left: 70, top: 55, zIndex: 28 },
  gameDesk4: { left: 47, top: 78, zIndex: 32 },
  gameDesk5: { left: 72, top: 80, zIndex: 33 },
};
