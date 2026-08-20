export type LocalModelRuntimeId = "vibevoice" | "qwen35-4b";

export type LocalModelRuntimePhase =
  "missing" | "stopped" | "preparing" | "loading" | "ready" | "running" | "paused" | "error";

export type LocalModelRuntimeErrorCode =
  | "model_missing"
  | "runtime_missing"
  | "dll_missing"
  | "ffmpeg_failed"
  | "wav_invalid"
  | "spawn_failed"
  | "crash"
  | "timeout"
  | "empty_output"
  | "parse_failed"
  | "no_reliable_speech"
  | "file_missing";

export interface LocalModelRuntimeHealth {
  id: LocalModelRuntimeId;
  phase: LocalModelRuntimePhase;
  ready: boolean;
  loaded: boolean;
  executable?: string;
  processId?: number;
  queuedJobs: number;
  activeJobId?: string;
  lastError?: LocalModelRuntimeErrorCode;
  detail?: string;
}

export interface LocalModelRuntimeProgress {
  phase: LocalModelRuntimePhase;
  completedUnits: number;
  totalUnits: number;
  message?: string;
}

export interface LocalModelResourceUsage {
  processId?: number;
  loaded: boolean;
  activeJobs: number;
  queuedJobs: number;
}

/** Common lifecycle contract. Model-specific request and response shapes remain strongly typed. */
export interface LocalModelRuntime<Request, Result> {
  prepare(): Promise<LocalModelRuntimeHealth>;
  health(): Promise<LocalModelRuntimeHealth>;
  load(): Promise<void>;
  run(request: Request): Promise<Result>;
  cancel(jobId?: string): void;
  progress(): LocalModelRuntimeProgress;
  resourceUsage(): LocalModelResourceUsage;
  release(reason?: string): void;
  repair(): Promise<LocalModelRuntimeHealth>;
}

export class LocalModelRuntimeError extends Error {
  constructor(
    readonly code: LocalModelRuntimeErrorCode,
    message: string = code,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "LocalModelRuntimeError";
  }
}

export const classifyLocalModelRuntimeError = (error: unknown): LocalModelRuntimeErrorCode => {
  if (error instanceof LocalModelRuntimeError) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  if (/model.*not_installed|model.*missing/i.test(message)) return "model_missing";
  if (/ffmpeg/i.test(message)) return "ffmpeg_failed";
  if (/invalid_transcription_wav|unsupported_transcription_wav/i.test(message))
    return "wav_invalid";
  if (/ENOENT|recording_file_unavailable|file.*missing/i.test(message)) return "file_missing";
  if (/dll|0xc0000135/i.test(message)) return "dll_missing";
  if (/timeout/i.test(message)) return "timeout";
  if (/spawn/i.test(message)) return "spawn_failed";
  if (/empty_output/i.test(message)) return "empty_output";
  if (/parse|invalid_json/i.test(message)) return "parse_failed";
  if (/no_reliable_speech/i.test(message)) return "no_reliable_speech";
  if (/runtime.*unavailable|runtime.*missing/i.test(message)) return "runtime_missing";
  return "crash";
};
