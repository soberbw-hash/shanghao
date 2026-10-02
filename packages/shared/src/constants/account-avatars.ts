export const ACCOUNT_AVATAR_PRESET_IDS = [
  "sky-cat",
  "mint-bear",
  "peach-fox",
  "moon-rabbit",
  "sun-duck",
  "lilac-deer",
  "aqua-whale",
  "amber-dog",
  "cloud-panda",
  "comet-otter",
  "snow-penguin",
  "golden-tiger",
  "moss-frog",
  "eucalyptus-koala",
  "dusk-owl",
  "rust-red-panda",
  "sand-lion",
  "oat-hamster",
  "lagoon-turtle",
  "chestnut-hedgehog",
  "ice-seal",
  "lemon-chick",
  "cocoa-capybara",
  "slate-raccoon",
  "silver-wolf",
  "jade-dragon",
  "orbit-robot",
  "lunar-astronaut",
  "ring-planet",
  "coral-mushroom",
  "linen-ghost",
  "apricot-squirrel",
] as const;

export type AccountAvatarPresetId = (typeof ACCOUNT_AVATAR_PRESET_IDS)[number];

export const isAccountAvatarPresetId = (value: unknown): value is AccountAvatarPresetId =>
  typeof value === "string" && ACCOUNT_AVATAR_PRESET_IDS.some((presetId) => presetId === value);

/** Stable fallback while an older relay or account record has no saved portrait. */
export const accountAvatarPresetForIdentity = (identity: string): AccountAvatarPresetId => {
  let hash = 2166136261;
  for (const character of identity) {
    hash ^= character.codePointAt(0)!;
    hash = Math.imul(hash, 16777619);
  }
  return ACCOUNT_AVATAR_PRESET_IDS[(hash >>> 0) % 10]!;
};
