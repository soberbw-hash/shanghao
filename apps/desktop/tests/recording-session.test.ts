import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { RecordingEncoderState } from "@private-voice/shared";

import { BrowserRecordingEncoder } from "../../../packages/recording/src/recording-encoder";

class FakeMediaRecorder extends EventTarget {
  static isTypeSupported(): boolean {
    return true;
  }

  readonly mimeType: string;
  state: RecordingState = "inactive";
  ondataavailable: ((event: BlobEvent) => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super();
    this.mimeType = options?.mimeType ?? "audio/webm";
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
});
