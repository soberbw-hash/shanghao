export type UiSound =
  | "button-click"
  | "enter-room"
  | "leave-room"
  | "knock-bell"
  | "popup-open"
  | "copy-success"
  | "device-switch"
  | "send-message"
  | "receive-message"
  | "connection-restored"
  | "connection-failed"
  | "mic-error"
  | "record-start"
  | "record-stop"
  | "mic-on"
  | "mic-off"
  | "speaker-muted"
  | "speaker-unmuted";

const soundUrls: Record<UiSound, string> = {
  "button-click": new URL("../../assets/sounds/button-click.wav", import.meta.url).href,
  "enter-room": new URL("../../assets/sounds/enter-room.wav", import.meta.url).href,
  "leave-room": new URL("../../assets/sounds/leave-room.wav", import.meta.url).href,
  "knock-bell": new URL("../../assets/sounds/knock-bell.wav", import.meta.url).href,
  "popup-open": new URL("../../assets/sounds/popup-open.wav", import.meta.url).href,
  "copy-success": new URL("../../assets/sounds/copy-success.wav", import.meta.url).href,
  "device-switch": new URL("../../assets/sounds/device-switch.wav", import.meta.url).href,
  "send-message": new URL("../../assets/sounds/send-message.wav", import.meta.url).href,
  "receive-message": new URL("../../assets/sounds/receive-message.wav", import.meta.url).href,
  "connection-restored": new URL("../../assets/sounds/connection-restored.wav", import.meta.url).href,
  "connection-failed": new URL("../../assets/sounds/connection-failed.wav", import.meta.url).href,
  "mic-error": new URL("../../assets/sounds/mic-error.wav", import.meta.url).href,
  "record-start": new URL("../../assets/sounds/record-start.wav", import.meta.url).href,
  "record-stop": new URL("../../assets/sounds/record-stop.wav", import.meta.url).href,
  "mic-on": new URL("../../assets/sounds/mic-on.wav", import.meta.url).href,
  "mic-off": new URL("../../assets/sounds/mic-off.wav", import.meta.url).href,
  "speaker-muted": new URL("../../assets/sounds/speaker-muted.wav", import.meta.url).href,
  "speaker-unmuted": new URL("../../assets/sounds/speaker-unmuted.wav", import.meta.url).href,
};

const audioCache = new Map<UiSound, HTMLAudioElement>();
let isEnabled = true;

export const setUiSoundEnabled = (enabled: boolean): void => {
  isEnabled = enabled;
};

export const playUiSound = (sound: UiSound): void => {
  if (!isEnabled) return;
  try {
    const template = audioCache.get(sound) ?? new Audio(soundUrls[sound]);
    template.preload = "auto";
    template.volume = 0.2;
    audioCache.set(sound, template);
    const playback = template.cloneNode(true) as HTMLAudioElement;
    playback.volume = template.volume;
    void playback.play().catch(() => undefined);
  } catch {
    // UI feedback must never block the room flow.
  }
};
