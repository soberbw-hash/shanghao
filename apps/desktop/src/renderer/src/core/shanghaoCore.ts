import type { DesktopApi, ScreenCaptureSourceDescriptor } from "@private-voice/shared";

export type CoreErrorCode = "aborted" | "timeout" | "unavailable" | "operation_failed";

export class ShangHaoCoreError extends Error {
  constructor(
    readonly code: CoreErrorCode,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ShangHaoCoreError";
  }
}

export interface CoreCommandOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ShangHaoCoreCapabilities {
  typedCommands: true;
  cancellation: true;
  timeouts: true;
  progressEvents: true;
  nativeCore: "optional";
}

const execute = async <Result>(
  name: string,
  operation: () => Promise<Result>,
  options: CoreCommandOptions = {},
): Promise<Result> => {
  if (options.signal?.aborted) {
    throw new ShangHaoCoreError("aborted", `${name} was cancelled`);
  }

  const timeoutMs = Math.max(0, options.timeoutMs ?? 0);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeAbort: (() => void) | undefined;
  const guards: Promise<never>[] = [];

  if (timeoutMs > 0) {
    guards.push(
      new Promise((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new ShangHaoCoreError("timeout", `${name} timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    );
  }
  if (options.signal) {
    guards.push(
      new Promise((_resolve, reject) => {
        const onAbort = () => reject(new ShangHaoCoreError("aborted", `${name} was cancelled`));
        options.signal?.addEventListener("abort", onAbort, { once: true });
        unsubscribeAbort = () => options.signal?.removeEventListener("abort", onAbort);
      }),
    );
  }

  try {
    return await Promise.race([operation(), ...guards]);
  } catch (error) {
    if (error instanceof ShangHaoCoreError) throw error;
    throw new ShangHaoCoreError(
      "operation_failed",
      `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  } finally {
    if (timeout) clearTimeout(timeout);
    unsubscribeAbort?.();
  }
};

const createScreenCaptureCommands = (api: DesktopApi) => ({
  listSources: (options?: CoreCommandOptions): Promise<ScreenCaptureSourceDescriptor[]> =>
    execute("screenCapture.listSources", () => api.screenCapture.listSources(), options),
  selectSource: (sourceId: string, options?: CoreCommandOptions): Promise<void> =>
    execute("screenCapture.selectSource", () => api.screenCapture.selectSource(sourceId), options),
  setContentProtection: (enabled: boolean, options?: CoreCommandOptions): Promise<void> =>
    execute(
      "screenCapture.setContentProtection",
      () => api.screenCapture.setContentProtection(enabled),
      options,
    ),
});

export const createShangHaoCore = (api: DesktopApi) => ({
  capabilities: {
    typedCommands: true,
    cancellation: true,
    timeouts: true,
    progressEvents: true,
    nativeCore: "optional",
  } satisfies ShangHaoCoreCapabilities,
  app: api.app,
  audio: api.audio,
  ai: api.ai,
  clipboard: api.clipboard,
  diagnostics: api.diagnostics,
  games: api.games,
  overlay: api.overlay,
  profile: api.profile,
  recording: api.recording,
  screenCapture: createScreenCaptureCommands(api),
  screenShareViewer: api.screenShareViewer,
  settings: api.settings,
  shortcuts: api.shortcuts,
  signaling: api.signaling,
  updates: api.updates,
  weather: api.weather,
  window: api.window,
  windows: api.windows,
});

let activeCore: ReturnType<typeof createShangHaoCore> | undefined;
let activeApi: DesktopApi | undefined;

export const getShangHaoCore = (): ReturnType<typeof createShangHaoCore> => {
  if (!activeCore || activeApi !== window.desktopApi) {
    activeApi = window.desktopApi;
    activeCore = createShangHaoCore(activeApi);
  }
  return activeCore;
};

// The proxy keeps module imports safe in Node-based unit tests and during the
// earliest renderer bootstrap. No desktop capability is resolved until use.
export const shanghaoCore = new Proxy({} as ReturnType<typeof createShangHaoCore>, {
  get: (_target, property) =>
    getShangHaoCore()[property as keyof ReturnType<typeof createShangHaoCore>],
});
