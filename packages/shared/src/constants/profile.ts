import type { BuiltInAvatarId } from "../types/settings.types";

export const BUILT_IN_AVATAR_IDS: BuiltInAvatarId[] = [
  "fox",
  "panda",
  "penguin",
  "cat",
  "dog",
];

export const RANDOM_NICKNAMES = [
  "摸鱼小猫",
  "暴躁企鹅",
  "打工小狗",
  "上号小狐",
  "低电量熊猫",
  "团战路人王",
  "今天不背锅",
  "语音小能手",
  "网卡别怪我",
  "开麦先笑",
  "Lucky Fox",
  "Sleepy Cat",
  "Panda Bro",
  "Tiny Penguin",
  "Happy Dog",
];

export const isBuiltInAvatarId = (value: unknown): value is BuiltInAvatarId =>
  typeof value === "string" && BUILT_IN_AVATAR_IDS.includes(value as BuiltInAvatarId);
