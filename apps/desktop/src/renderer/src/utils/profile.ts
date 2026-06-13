import {
  BUILT_IN_AVATAR_IDS,
  RANDOM_NICKNAMES,
  type BuiltInAvatarId,
} from "@private-voice/shared";

import catAvatar from "../assets/avatars/cat.svg";
import dogAvatar from "../assets/avatars/dog.svg";
import foxAvatar from "../assets/avatars/fox.svg";
import pandaAvatar from "../assets/avatars/panda.svg";
import penguinAvatar from "../assets/avatars/penguin.svg";

export const avatarOptions: Array<{ id: BuiltInAvatarId; label: string; src: string }> = [
  { id: "fox", label: "小狐狸", src: foxAvatar },
  { id: "panda", label: "小熊猫", src: pandaAvatar },
  { id: "penguin", label: "小企鹅", src: penguinAvatar },
  { id: "cat", label: "小猫", src: catAvatar },
  { id: "dog", label: "小狗", src: dogAvatar },
];

export const getAvatarSrc = (avatarId?: BuiltInAvatarId): string | undefined =>
  avatarOptions.find((avatar) => avatar.id === avatarId)?.src;

export const randomAvatarId = (): BuiltInAvatarId =>
  BUILT_IN_AVATAR_IDS[Math.floor(Math.random() * BUILT_IN_AVATAR_IDS.length)] ?? "fox";

export const randomNickname = (): string =>
  RANDOM_NICKNAMES[Math.floor(Math.random() * RANDOM_NICKNAMES.length)] ?? "上号小狐";
