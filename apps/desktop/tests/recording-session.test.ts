import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RecordingEncoderState, RecordingState } from "@private-voice/shared";

import {
  BrowserRecordingEncoder,
  RECORDING_AUDIO_BITS_PER_SECOND,
} from "../../../packages/recording/src/recording-encoder";
import { RecordingService } from "../../../packages/recording/src/recording-service";

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported(): boolean {
    return true;
  }

  readonly mimeType: string;
  readonly audioBitsPerSecond?: number;
  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super();
    this.mimeType = options?.mimeType ?? "audio/webm";
    this.audioBitsPerSecond = options?.audioBitsPerSecond;
  }

  start(): void {
    this.state = "recording";
  }

  requestData(): void {
    this.ondataavailable?.({ data: new Blob(["recorded-audio"]) } as BlobEvent);
  }

  stop(): void {
    if (this.state === "inactive") throw new DOMException("inactive", "InvalidStateError");
    this.requestData();
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }

  stopUnexpectedly(): void {
    this.requestData();
    this.state = "inactive";
    this.dispatchEvent(new Event("stop"));
  }
}

test("recording encoder preserves buffered audio after an unexpected recorder stop", async () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: FakeMediaRecorder,
  });

  try {
    const encoder = new BrowserRecordingEncoder({
      mimeType: "audio/webm",
      encoderState: RecordingEncoderState.FallbackTranscode,
      requiresTranscode: true,
      supportedMimeTypes: ["audio/webm"],
    });
    encoder.start({} as MediaStream);
    assert.equal(encoder.hasRecording(), true);

    const recorder = (encoder as unknown as { mediaRecorder: FakeMediaRecorder }).mediaRecorder;
    assert.equal(recorder.audioBitsPerSecond, RECORDING_AUDIO_BITS_PER_SECOND);
    assert.equal(RECORDING_AUDIO_BITS_PER_SECOND, 32_000);
    recorder.stopUnexpectedly();

    const result = await encoder.stop();
    assert.ok(result.blob.size > 0);
    assert.equal(encoder.hasRecording(), false);
  } finally {
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: originalMediaRecorder,
    });
  }
});

test("streaming recording encoder forwards chunks in order without retaining a final blob", async () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: FakeMediaRecorder,
  });

  try {
    const received: string[] = [];
    const encoder = new BrowserRecordingEncoder({
      mimeType: "audio/webm",
      encoderState: RecordingEncoderState.FallbackTranscode,
      requiresTranscode: true,
      supportedMimeTypes: ["audio/webm"],
    });
    encoder.start({} as MediaStream, async (buffer) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      received.push(Buffer.from(buffer).toString("utf8"));
    });

    const result = await encoder.stop();
    assert.equal(result.blob, undefined);
    assert.deepEqual(received, ["recorded-audio", "recorded-audio"]);
    assert.equal(encoder.hasRecording(), false);
  } finally {
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: originalMediaRecorder,
    });
  }
});

test("a failed streaming writer releases the stopped encoder for a new recording", async () => {
  const originalMediaRecorder = globalThis.MediaRecorder;
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: FakeMediaRecorder,
  });
  try {
    const encoder = new BrowserRecordingEncoder({
      mimeType: "audio/webm",
      encoderState: RecordingEncoderState.FallbackTranscode,
      requiresTranscode: true,
      supportedMimeTypes: ["audio/webm"],
    });
    encoder.start({} as MediaStream, async () => {
      throw new Error("recording_chunk_write_failed");
    });
    await assert.rejects(encoder.stop(), /recording_chunk_write_failed/);
    assert.equal(encoder.hasRecording(), false);
    encoder.start({} as MediaStream);
    assert.equal(encoder.hasRecording(), true);
    await encoder.stop();
  } finally {
    Object.defineProperty(globalThis, "MediaRecorder", {
      configurable: true,
      value: originalMediaRecorder,
    });
  }
});

test("a thrown recording finalizer reports failure and keeps main-process recovery files", async () => {
  let abortCalls = 0;
  let sealCalls = 0;
  const service = new RecordingService({
    exporter: { exportRecording: async () => ({ ok: false }) },
    streamingExporter: {
      startSession: async () => ({ ok: true, sessionId: "stream-one" }),
      appendChunk: async () => undefined,
      finalizeSession: async () => {
        throw new Error("finalize_unavailable");
      },
      sealSession: async () => {
        sealCalls += 1;
      },
      abortSession: async () => {
        abortCalls += 1;
      },
    },
  });
  const internal = service as unknown as {
    encoder: {
      hasRecording: () => boolean;
      stop: () => Promise<{ mimeType: string; durationMs: number }>;
    };
    streamSession?: Promise<string>;
  };
  internal.encoder = {
    hasRecording: () => true,
    stop: async () => ({ mimeType: "audio/webm", durationMs: 1_000 }),
  };
  internal.streamSession = Promise.resolve("stream-one");
  await assert.rejects(
    service.stop(
      {
        targetSampleRate: 48_000,
        targetFormat: "m4a-aac",
        channels: 1,
        includeMixedCallAudio: true,
      },
      48_000,
    ),
    /finalize_unavailable/,
  );
  assert.equal(service.getState().state, RecordingState.Failed);
  assert.equal(internal.streamSession, undefined);
  assert.equal(sealCalls, 1);
  assert.equal(abortCalls, 0, "a recoverable main-process input must not be deleted");
});

test("an encoder write failure seals its old stream before releasing the session", async () => {
  const sealed: string[] = [];
  const service = new RecordingService({
    exporter: { exportRecording: async () => ({ ok: false }) },
    streamingExporter: {
      startSession: async () => ({ ok: true, sessionId: "stream-one" }),
      appendChunk: async () => undefined,
      finalizeSession: async () => ({ ok: false }),
      sealSession: async (sessionId) => {
        sealed.push(sessionId);
      },
      abortSession: async () => {
        throw new Error("failed audio must be preserved");
      },
    },
  });
  const internal = service as unknown as {
    encoder: { hasRecording: () => boolean; stop: () => Promise<never> };
    streamSession?: Promise<string>;
  };
  internal.encoder = {
    hasRecording: () => true,
    stop: async () => {
      throw new Error("recording_chunk_write_failed");
    },
  };
  internal.streamSession = Promise.resolve("stream-one");
  await assert.rejects(
    service.stop(
      {
        targetSampleRate: 48_000,
        targetFormat: "m4a-aac",
        channels: 1,
        includeMixedCallAudio: true,
      },
      48_000,
    ),
    /recording_chunk_write_failed/,
  );
  assert.deepEqual(sealed, ["stream-one"]);
  assert.equal(internal.streamSession, undefined);
  assert.equal(service.getState().state, RecordingState.Failed);
});

test("saving a recording owns the session until the one stop operation completes", async () => {
  let finishEncoder = (_value: { blob: Blob; mimeType: string; durationMs: number }) => undefined;
  const encoderResult = new Promise<{ blob: Blob; mimeType: string; durationMs: number }>(
    (resolve) => {
      finishEncoder = resolve;
    },
  );
  let stopCalls = 0;
  let exportCalls = 0;
  const service = new RecordingService({
    exporter: {
      exportRecording: async () => {
        exportCalls += 1;
        return {
          ok: true,
          recordingId: "recording-one",
          filePath: "recording-one.m4a",
          fileSize: 12,
          mimeType: "audio/mp4",
        };
      },
    },
  });
  (
    service as unknown as {
      encoder: { hasRecording: () => boolean; stop: () => typeof encoderResult };
    }
  ).encoder = {
    hasRecording: () => true,
    stop: () => {
      stopCalls += 1;
      return encoderResult;
    },
  };
  const options = {
    targetSampleRate: 48_000,
    targetFormat: "m4a-aac" as const,
    channels: 1,
    includeMixedCallAudio: true,
  };
  const first = service.stop(options, 48_000);
  const second = service.stop(options, 48_000);
  assert.equal(first, second);
  assert.equal(service.start({} as MediaStream).state, RecordingState.Stopping);
  await service.discard();
  assert.equal(service.getState().state, RecordingState.Stopping);
  finishEncoder({ blob: new Blob(["audio"]), mimeType: "audio/webm", durationMs: 1_000 });
  await first;
  assert.equal(stopCalls, 1);
  assert.equal(exportCalls, 1);
  assert.equal(service.getState().state, RecordingState.Saved);
});

test("a failed discard leaves the recording in a visible failure state", async () => {
  let abortCalls = 0;
  let sealCalls = 0;
  const service = new RecordingService({
    exporter: { exportRecording: async () => ({ ok: false }) },
    streamingExporter: {
      startSession: async () => ({ ok: true, sessionId: "stream-one" }),
      appendChunk: async () => undefined,
      finalizeSession: async () => ({ ok: false }),
      sealSession: async () => {
        sealCalls += 1;
      },
      abortSession: async () => {
        abortCalls += 1;
      },
    },
  });
  const internal = service as unknown as {
    encoder: { hasRecording: () => boolean; stop: () => Promise<never> };
    streamSession?: Promise<string>;
  };
  internal.encoder = {
    hasRecording: () => true,
    stop: async () => {
      throw new Error("recording_chunk_write_failed");
    },
  };
  internal.streamSession = Promise.resolve("stream-one");
  await assert.rejects(service.discard(), /recording_chunk_write_failed/);
  assert.equal(service.getState().state, RecordingState.Failed);
  assert.equal(internal.streamSession, undefined);
  assert.equal(sealCalls, 1);
  assert.equal(abortCalls, 0, "a failed discard must not erase a possible recovery file");
});

test("discard reports a failed main-process deletion instead of claiming success", async () => {
  let sealCalls = 0;
  const service = new RecordingService({
    exporter: { exportRecording: async () => ({ ok: false }) },
    streamingExporter: {
      startSession: async () => ({ ok: true, sessionId: "stream-one" }),
      appendChunk: async () => undefined,
      finalizeSession: async () => ({ ok: false }),
      sealSession: async () => {
        sealCalls += 1;
      },
      abortSession: async () => {
        throw new Error("recording_discard_unavailable");
      },
    },
  });
  const internal = service as unknown as {
    encoder: {
      hasRecording: () => boolean;
      stop: () => Promise<{ mimeType: string; durationMs: number }>;
    };
    streamSession?: Promise<string>;
  };
  internal.encoder = {
    hasRecording: () => true,
    stop: async () => ({ mimeType: "audio/webm", durationMs: 1_000 }),
  };
  internal.streamSession = Promise.resolve("stream-one");
  await assert.rejects(service.discard(), /recording_discard_unavailable/);
  assert.equal(service.getState().state, RecordingState.Failed);
  assert.equal(sealCalls, 1);
});

test("duplicate starts and a discard in progress keep one recording owner", async () => {
  let finishDiscard = () => undefined;
  const discardGate = new Promise<void>((resolve) => {
    finishDiscard = resolve;
  });
  let active = false;
  let startCalls = 0;
  let stopCalls = 0;
  const service = new RecordingService({
    exporter: { exportRecording: async () => ({ ok: false }) },
  });
  (
    service as unknown as {
      encoder: {
        hasRecording: () => boolean;
        start: () => void;
        stop: () => Promise<{ blob: Blob; mimeType: string; durationMs: number }>;
      };
    }
  ).encoder = {
    hasRecording: () => active,
    start: () => {
      active = true;
      startCalls += 1;
    },
    stop: async () => {
      stopCalls += 1;
      await discardGate;
      active = false;
      return { blob: new Blob(), mimeType: "audio/webm", durationMs: 1_000 };
    },
  };
  assert.equal(service.start({} as MediaStream).state, RecordingState.Recording);
  assert.equal(service.start({} as MediaStream).state, RecordingState.Recording);
  assert.equal(startCalls, 1);
  const discarding = service.discard();
  assert.equal(service.start({} as MediaStream).state, RecordingState.Stopping);
  await assert.rejects(
    service.stop(
      {
        targetSampleRate: 48_000,
        targetFormat: "m4a-aac",
        channels: 1,
        includeMixedCallAudio: true,
      },
      48_000,
    ),
    /recording_discard_in_progress/,
  );
  await service.discard();
  assert.equal(stopCalls, 1);
  finishDiscard();
  await discarding;
  assert.equal(service.getState().state, RecordingState.Idle);
});

test("renderer recording runtime survives room component reconstruction", () => {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    path.join(testDirectory, "../src/renderer/src/hooks/useRecordingController.ts"),
    "utf8",
  );

  assert.equal(source.includes("__shanghaoRecordingRuntimeV2__"), true);
  assert.equal(source.includes("globalThis as typeof globalThis"), true);
  assert.equal(source.includes("recordingService.hasRecording()"), true);
  assert.equal(source.includes("useRef<RecordingService"), false);
  assert.equal(source.includes("recording_runtime_state_reconciled"), true);
  assert.equal(source.includes("currentState === RecordingState.Saving"), true);
  assert.equal(source.includes("if (runtime.finalizing) return runtime.finalizing"), true);
  assert.equal(source.includes("if (runtime.mix === mix) runtime.mix = null"), true);
});
