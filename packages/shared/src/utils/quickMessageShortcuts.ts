import type { QuickMessageSettings, QuickMessageShortcutSlot } from "../types/quick-message.types";
import {
  DEFAULT_QUICK_MESSAGE_SLOTS,
  DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS,
  normalizeQuickMessageSlots,
} from "../constants/quick-messages";

/** Preserve every slot index and binding while gating all global quick-message triggers. */
export const getQuickMessageShortcutSlots = (
  settings: QuickMessageSettings,
): QuickMessageShortcutSlot[] =>
  [
    ...normalizeQuickMessageSlots(settings.slots, DEFAULT_QUICK_MESSAGE_SLOTS),
    ...normalizeQuickMessageSlots(settings.musicSlots, DEFAULT_QUICK_MESSAGE_MUSIC_SLOTS),
  ].map((slot) => ({
    ...slot,
    enabled: settings.shortcutsEnabled === true && slot.enabled,
  }));
