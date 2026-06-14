export type UiSound =
  | "click"
  | "mic-on"
  | "mic-off"
  | "join"
  | "leave"
  | "connected"
  | "failed"
  | "knock"
  | "message"
  | "record-start"
  | "record-stop";

type ToneStep = {
  frequency: number;
  durationMs: number;
  gain?: number;
};

let sharedContext: AudioContext | null = null;

const sequences: Record<UiSound, ToneStep[]> = {
  click: [{ frequency: 620, durationMs: 35, gain: 0.035 }],
  "mic-on": [{ frequency: 660, durationMs: 90 }],
  "mic-off": [{ frequency: 440, durationMs: 90 }],
  join: [
    { frequency: 523, durationMs: 70 },
    { frequency: 659, durationMs: 90 },
  ],
  leave: [
    { frequency: 523, durationMs: 70 },
    { frequency: 392, durationMs: 100 },
  ],
  connected: [
    { frequency: 659, durationMs: 60 },
    { frequency: 784, durationMs: 80 },
  ],
  failed: [
    { frequency: 440, durationMs: 80 },
    { frequency: 349, durationMs: 110 },
  ],
  knock: [
    { frequency: 784, durationMs: 55, gain: 0.075 },
    { frequency: 988, durationMs: 70, gain: 0.065 },
  ],
  message: [{ frequency: 740, durationMs: 55, gain: 0.04 }],
  "record-start": [{ frequency: 650, durationMs: 75 }],
  "record-stop": [{ frequency: 420, durationMs: 85 }],
};

const getAudioContext = () => {
  if (!sharedContext) {
    sharedContext = new AudioContext();
  }

  if (sharedContext.state === "suspended") {
    void sharedContext.resume().catch(() => undefined);
  }

  return sharedContext;
};

export const playUiSound = (sound: UiSound): void => {
  try {
    const context = getAudioContext();
    let cursor = context.currentTime;

    for (const step of sequences[sound]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = step.frequency;
      gain.gain.setValueAtTime(0.0001, cursor);
      gain.gain.linearRampToValueAtTime(step.gain ?? 0.06, cursor + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, cursor + step.durationMs / 1000);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(cursor);
      oscillator.stop(cursor + step.durationMs / 1000);
      cursor += step.durationMs / 1000 + 0.025;
    }
  } catch {
    // UI feedback must never block the room flow.
  }
};
