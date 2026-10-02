import {
  DEFAULT_QUICK_MESSAGE_SLOTS,
  getQuickMessageShortcutSlots,
  type AppSettings,
} from "@private-voice/shared";

type ShortcutBindings = {
  configureGlobalMute: (accelerator: string) => Promise<boolean>;
  configureRecordingMarker: (accelerator: string) => Promise<boolean>;
  configurePushToTalk: (accelerator: string, enabled: boolean) => Promise<boolean>;
  configureQuickMessage: (slot: number, accelerator: string) => Promise<boolean>;
};

const quickMessageBindings = (settings: AppSettings): string[] =>
  getQuickMessageShortcutSlots(settings.quickMessages).map((slot) =>
    slot.enabled ? slot.shortcut.trim() : "",
  );

const configureQuickMessageMap = async (
  bindings: string[],
  shortcuts: ShortcutBindings,
): Promise<number[]> => {
  for (let index = 0; index < bindings.length; index++) {
    await shortcuts.configureQuickMessage(index, "").catch(() => false);
  }
  const failed: number[] = [];
  for (const [index, accelerator] of bindings.entries()) {
    if (
      accelerator &&
      !(await shortcuts.configureQuickMessage(index, accelerator).catch(() => false))
    ) {
      failed.push(index);
    }
  }
  return failed;
};

/** Keep persisted shortcut values aligned with successful native registrations. */
export const applyShortcutSettingsPatch = async (
  previous: AppSettings,
  current: AppSettings,
  partial: Partial<AppSettings>,
  shortcuts: ShortcutBindings,
): Promise<Partial<AppSettings>> => {
  const rollback: Partial<AppSettings> = {};
  if ("globalMuteShortcut" in partial) {
    const applied = await shortcuts
      .configureGlobalMute(current.globalMuteShortcut)
      .catch(() => false);
    if (!applied && current.globalMuteShortcut) {
      rollback.globalMuteShortcut = previous.globalMuteShortcut;
    }
  }
  if ("recordingMarkerShortcut" in partial) {
    const applied = await shortcuts
      .configureRecordingMarker(current.recordingMarkerShortcut)
      .catch(() => false);
    if (!applied && current.recordingMarkerShortcut) {
      rollback.recordingMarkerShortcut = previous.recordingMarkerShortcut;
    }
  }
  if ("pushToTalkShortcut" in partial || "isPushToTalkEnabled" in partial) {
    const applied = await shortcuts
      .configurePushToTalk(current.pushToTalkShortcut, current.isPushToTalkEnabled)
      .catch(() => false);
    if (!applied) {
      rollback.pushToTalkShortcut = previous.pushToTalkShortcut;
      rollback.isPushToTalkEnabled = previous.isPushToTalkEnabled;
      await shortcuts
        .configurePushToTalk(previous.pushToTalkShortcut, previous.isPushToTalkEnabled)
        .catch(() => false);
    }
  }
  if ("quickMessages" in partial) {
    const before = quickMessageBindings(previous);
    const desired = quickMessageBindings(current);
    if (before.some((binding, index) => binding !== desired[index])) {
      const failed = await configureQuickMessageMap(desired, shortcuts);
      if (failed.length) {
        if (
          previous.quickMessages.shortcutsEnabled !== true &&
          current.quickMessages.shortcutsEnabled
        ) {
          // One occupied key must not lock the entire editor behind the master switch.
          const slots = getQuickMessageShortcutSlots(current.quickMessages).map((slot, index) =>
            failed.includes(index) ? { ...slot, enabled: false } : slot,
          );
          const voiceCount = DEFAULT_QUICK_MESSAGE_SLOTS.length;
          rollback.quickMessages = {
            ...current.quickMessages,
            slots: slots.slice(0, voiceCount),
            musicSlots: slots.slice(voiceCount),
          };
        } else {
          await configureQuickMessageMap(before, shortcuts);
          rollback.quickMessages = {
            ...current.quickMessages,
            slots: previous.quickMessages.slots,
            musicSlots: previous.quickMessages.musicSlots,
            shortcutsEnabled: previous.quickMessages.shortcutsEnabled ?? false,
            musicShortcutsEnabled: previous.quickMessages.musicShortcutsEnabled ?? false,
          };
        }
      }
    }
  }
  return rollback;
};

/** Reset registered keys before applying defaults, so an old key cannot block a new owner. */
export const reconcileResetShortcuts = async (
  settings: AppSettings,
  shortcuts: ShortcutBindings,
): Promise<string[]> => {
  const bindings = quickMessageBindings(settings);

  await shortcuts.configureGlobalMute("");
  await shortcuts.configureRecordingMarker("");
  await shortcuts.configurePushToTalk("", false);
  for (let index = 0; index < bindings.length; index++) {
    await shortcuts.configureQuickMessage(index, "");
  }

  const failed: string[] = [];
  if (
    settings.globalMuteShortcut &&
    !(await shortcuts.configureGlobalMute(settings.globalMuteShortcut))
  )
    failed.push("mute");
  if (
    settings.recordingMarkerShortcut &&
    !(await shortcuts.configureRecordingMarker(settings.recordingMarkerShortcut))
  )
    failed.push("recording-marker");
  if (
    settings.isPushToTalkEnabled &&
    !(await shortcuts.configurePushToTalk(settings.pushToTalkShortcut, true))
  )
    failed.push("push-to-talk");
  for (const [index, accelerator] of bindings.entries()) {
    if (accelerator) {
      if (!(await shortcuts.configureQuickMessage(index, accelerator))) {
        failed.push(`quick-message:${index}`);
      }
    }
  }
  return failed;
};
