export const VOICE_REPLAY_SHORTCUT_CHANGED = "shanghao:voice-replay-shortcut";

export function readVoiceReplayShortcut(): string {
  try {
    return localStorage.getItem("voice-replay-shortcut") ?? "Ctrl+Shift+F8";
  } catch {
    return "Ctrl+Shift+F8";
  }
}

/** Publish after Main accepts the binding, including when local storage is unavailable. */
export function saveVoiceReplayShortcut(shortcut: string): boolean {
  let persisted = true;
  try {
    localStorage.setItem("voice-replay-shortcut", shortcut);
  } catch {
    persisted = false;
  }
  window.dispatchEvent(new CustomEvent(VOICE_REPLAY_SHORTCUT_CHANGED, { detail: shortcut }));
  return persisted;
}
