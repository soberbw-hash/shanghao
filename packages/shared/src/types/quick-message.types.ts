export interface QuickMessagePreset {
  id: string;
  label: string;
  content: string;
  category: string;
  /** Local sound asset identifier. The actual audio is never sent through signaling. */
  soundId?: string;
  /** Optional hidden metadata used by the voice-library filters and hover hint. */
  streamer?: string;
  gameTags?: string[];
}

export interface QuickMessageShortcutSlot {
  presetId?: string;
  shortcut: string;
  enabled: boolean;
}

export interface QuickMessageSettings {
  soundEnabled: boolean;
  soundVolume: number;
  slots: QuickMessageShortcutSlot[];
}
