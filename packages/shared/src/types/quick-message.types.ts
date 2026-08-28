export type QuickMessageMediaType = "voice" | "music";

export interface QuickMessagePreset {
  id: string;
  label: string;
  content: string;
  category: string;
  /** One-shot voice line or short music meme. Omitted legacy values are voices. */
  mediaType?: QuickMessageMediaType;
  /** Local sound asset identifier. The actual audio is never sent through signaling. */
  soundId?: string;
  /** Optional hidden metadata used by the voice-library filters and hover hint. */
  streamer?: string;
  gameTags?: string[];
  /** Hidden tags used to filter music without changing its original title. */
  tags?: string[];
}

export interface QuickMessageShortcutSlot {
  presetId?: string;
  shortcut: string;
  enabled: boolean;
}

export interface QuickMessageSettings {
  soundEnabled: boolean;
  soundVolume: number;
  /** The music clip shown in the dedicated room quick-play button. */
  musicPresetId?: string;
  /** Three optional music shortcuts kept separate from the five voice-message slots. */
  musicSlots: QuickMessageShortcutSlot[];
  slots: QuickMessageShortcutSlot[];
}
