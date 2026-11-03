export interface BackgroundAudioState {
  revision: number;
  available: boolean;
  enabled: boolean;
  shortcut: string;
  phase: "off" | "ready" | "waiting" | "balancing" | "recovering";
}
export interface BackgroundAudioApi {
  pulse: (activity: { inRoom: boolean; speaking: boolean }) => Promise<BackgroundAudioState>;
  configure: (patch: { enabled?: boolean; shortcut?: string }) => Promise<BackgroundAudioState>;
  onChanged: (listener: (state: BackgroundAudioState) => void) => () => void;
}
