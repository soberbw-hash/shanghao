export interface VoiceReplayClip {
  id: string;
  title: string;
  createdAt: number;
  durationMs: number;
  byteLength: number;
}

export interface VoiceReplayTranscriptSegment {
  text: string;
  startMs: number;
  endMs: number;
  timestampPrecision: "aligned" | "chunk";
  reviewStatus?: "edited";
}

export type VoiceReplayTranscript =
  | { version: 1; createdAt: number; text: string }
  | {
      version: 2;
      createdAt: number;
      text: string;
      sourceModel: string;
      segments: VoiceReplayTranscriptSegment[];
      derivedFromTrim?: true;
    };

/** Local-only library: deliberately separate from automatic recording transcription/upload. */
export interface VoiceReplayApi {
  list: () => Promise<VoiceReplayClip[]>;
  save: (title: string, bytes: Uint8Array) => Promise<VoiceReplayClip>;
  read: (id: string) => Promise<Uint8Array>;
  rename: (id: string, title: string) => Promise<void>;
  trim: (id: string, fromMs: number, toMs: number) => Promise<VoiceReplayClip>;
  transcribeLocal: (id: string) => Promise<string>;
  readTranscript: (id: string) => Promise<string | undefined>;
  readTranscriptDetail: (id: string) => Promise<VoiceReplayTranscript | undefined>;
  reviseTranscriptSegment: (
    id: string,
    expectedCreatedAt: number,
    index: number,
    text: string,
  ) => Promise<VoiceReplayTranscript>;
  remove: (id: string) => Promise<void>;
  export: (id: string) => Promise<boolean>;
  shortcut: (accelerator: string) => Promise<boolean>;
  onSaveShortcut: (listener: () => void) => () => void;
}
