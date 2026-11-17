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
  "ip-01",
  "ip-02",
  "ip-03",
  "ip-04",
  "ip-05",
  "ip-06",
  "ip-07",
  "ip-08",
  "ip-09",
  "ip-10",
  "ip-11",
  "ip-12",
  "ip-13",
  "ip-14",
  "ip-15",
  "ip-16",
  "ip-17",
  "ip-18",
  "ip-19",
  "ip-20",
  "ip-21",
  "ip-22",
  "ip-23",
  "ip-24",
  "ip-25",
  "ip-26",
  "ip-27",
  "ip-28",
  "ip-29",
  "ip-30",
  "ip-31",
  "ip-32",
  "ip-33",
  "ip-34",
  "ip-35",
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
  const portraits = ACCOUNT_AVATAR_PRESET_IDS.filter((id) => id.startsWith("ip-"));
  return portraits[(hash >>> 0) % portraits.length]!;
};
