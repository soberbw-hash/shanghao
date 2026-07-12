import { BUILT_IN_AVATAR_IDS, type BuiltInAvatarId } from "@private-voice/shared";

import catAvatar from "../assets/avatars/cat-scene.png";
import corgiAvatar from "../assets/avatars/corgi-scene.png";
import duckAvatar from "../assets/avatars/duck-scene.png";
import foxAvatar from "../assets/avatars/fox-scene.png";
import pandaAvatar from "../assets/avatars/panda-scene.png";

export const avatarOptions: Array<{ id: BuiltInAvatarId; label: string; src: string }> = [
  { id: "fox", label: "狐狸", src: foxAvatar },
  { id: "cat", label: "猫", src: catAvatar },
  { id: "duck", label: "鸭子", src: duckAvatar },
  { id: "panda", label: "熊猫", src: pandaAvatar },
  { id: "corgi", label: "柯基", src: corgiAvatar },
];

export const getAvatarSrc = (avatarId?: BuiltInAvatarId): string | undefined =>
  avatarOptions.find((avatar) => avatar.id === avatarId)?.src;

export const getStableAvatarId = (peerId: string, avatarId?: BuiltInAvatarId): BuiltInAvatarId => {
  if (avatarId && BUILT_IN_AVATAR_IDS.includes(avatarId)) return avatarId;
  const hash = [...peerId].reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return BUILT_IN_AVATAR_IDS[hash % BUILT_IN_AVATAR_IDS.length] ?? "fox";
};

export const getAvatarFaceStyle = (avatarId?: BuiltInAvatarId) => {
  const origins: Record<BuiltInAvatarId, string> = {
    fox: "50% 30%",
    cat: "50% 29%",
    duck: "50% 31%",
    panda: "50% 30%",
    corgi: "50% 30%",
  };
  return {
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
    transform: "scale(2.05)",
    transformOrigin: origins[avatarId ?? "fox"],
  };
};

export const randomAvatarId = (): BuiltInAvatarId =>
  BUILT_IN_AVATAR_IDS[Math.floor(Math.random() * BUILT_IN_AVATAR_IDS.length)] ?? "fox";
