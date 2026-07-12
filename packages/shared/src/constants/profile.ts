import type { BuiltInAvatarId } from "../types/settings.types";

export const BUILT_IN_AVATAR_IDS: BuiltInAvatarId[] = ["fox", "cat", "duck", "panda", "corgi"];

export const isBuiltInAvatarId = (value: unknown): value is BuiltInAvatarId =>
  typeof value === "string" && BUILT_IN_AVATAR_IDS.includes(value as BuiltInAvatarId);
