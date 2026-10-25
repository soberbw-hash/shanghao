export interface ApplicationAudioSource {
  id: string;
  name: string;
  processName: string;
  /** Local application icon only, never a window/screen image. */
  appIconDataUrl?: string;
}
export interface ApplicationAudioSession {
  sessionId: string;
  sampleRate: 48000;
  channels: 1 | 2;
  format: "s16le";
  gain: number;
}
export interface ApplicationAudioState {
  sessionId: string;
  phase: "starting" | "sharing" | "stopped" | "error";
  code?: string;
  gain: number;
}
export interface ApplicationAudioFrame {
  sessionId: string;
  sequence: number;
  frames: number;
  channels: 1 | 2;
  sampleRate: 48000;
  format: "s16le";
  data: Uint8Array;
  capturedAt: number;
}
export interface ApplicationAudioApi {
  listSources: () => Promise<{ supported: boolean; sources: ApplicationAudioSource[] }>;
  start: (sourceId: string) => Promise<ApplicationAudioSession>;
  stop: (sessionId?: string) => Promise<void>;
  setGain: (sessionId: string, gain: number) => Promise<ApplicationAudioState>;
  acknowledge: (sessionId: string, sequence: number) => void;
  onFrame: (listener: (frame: ApplicationAudioFrame) => void) => () => void;
  onState: (listener: (state: ApplicationAudioState) => void) => () => void;
}
