import {
  BUILT_IN_AVATAR_IDS,
  RANDOM_NICKNAMES,
  type BuiltInAvatarId,
} from "@private-voice/shared";

import catAvatar from "../assets/avatars/cat-3d.png";
import corgiAvatar from "../assets/avatars/corgi-3d.png";
import duckAvatar from "../assets/avatars/duck-3d.png";
import foxAvatar from "../assets/avatars/fox-3d.png";
import pandaAvatar from "../assets/avatars/panda-3d.png";

export const avatarOptions: Array<{ id: BuiltInAvatarId; label: string; src: string }> = [
  { id: "fox", label: "狐狸", src: foxAvatar },
  { id: "cat", label: "猫", src: catAvatar },
  { id: "duck", label: "鸭子", src: duckAvatar },
  { id: "panda", label: "熊猫", src: pandaAvatar },
  { id: "corgi", label: "柯基", src: corgiAvatar },
];

export const getAvatarSrc = (avatarId?: BuiltInAvatarId): string | undefined =>
  avatarOptions.find((avatar) => avatar.id === avatarId)?.src;

export const randomAvatarId = (): BuiltInAvatarId =>
  BUILT_IN_AVATAR_IDS[Math.floor(Math.random() * BUILT_IN_AVATAR_IDS.length)] ?? "fox";

export const randomNickname = (): string =>
  RANDOM_NICKNAMES[Math.floor(Math.random() * RANDOM_NICKNAMES.length)] ?? "上号小狐";
