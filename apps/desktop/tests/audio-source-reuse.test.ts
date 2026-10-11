import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { MICROPHONE_PROCESSING_SAMPLE_RATE, MicPermissionState } from "@private-voice/shared";

const source = ts.transpileModule(
  readFileSync(
    new URL("../src/renderer/src/features/audio/audioSource.ts", import.meta.url),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const harness = () => {
  let requests = 0;
  class Track {
    readyState = "live";
    muted = false;
    stopped = false;
    settings = {
      echoCancellation: true,
      autoGainControl: true,
      sampleRate: 48_000,
      channelCount: 1,
    };
    getSettings() {
      return this.settings;
    }
    clone() {
      const copy = new Track();
      copy.settings = { ...this.settings };
      return copy;
    }
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    }
  }
  class Stream {
    constructor(readonly tracks: Track[]) {}
    getAudioTracks() {
      return this.tracks;
    }
    getTracks() {
      return this.tracks;
    }
  }
  const original = new Track();
  const input = new Stream([original]);
  const fresh = new Stream([new Track()]);
  const module = {
    exports: {} as {
      acquireAudioSource: (
        device: string | undefined,
        processing: object,
        input?: Stream,
      ) => Promise<{
        stream: Stream;
        stopInputOnDispose: boolean;
        diagnostics: { actualSampleRate: number };
      }>;
      releaseAcquiredAudioSource: (source: { stream: Stream; stopInputOnDispose: boolean }) => void;
    },
  };
  runInNewContext(source, {
    exports: module.exports,
    MediaStream: Stream,
    require: (id: string) => {
      if (id === "@private-voice/shared")
        return { MICROPHONE_PROCESSING_SAMPLE_RATE, MicPermissionState };
      if (id === "@private-voice/webrtc")
        return {
          requestMicrophoneStream: async () => {
            requests++;
            return { stream: fresh, diagnostics: {} };
          },
        };
      if (id === "./phoneMicSource")
        return {
          PHONE_MIC_DEVICE_ID: "phone",
          phoneMicSource: { getStream: () => input, getDiagnostics: () => ({}) },
        };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  return { ...module.exports, original, input, fresh, requests: () => requests };
};

test("same-device DSP rebuild clones capture and releases only its owned track", async () => {
  const state = harness();
  const result = await state.acquireAudioSource(
    undefined,
    { echoCancellation: true, autoGainControl: true },
    state.input,
  );
  assert.equal(state.requests(), 0);
  assert.notEqual(result.stream.getAudioTracks()[0], state.original);
  assert.equal(result.diagnostics.actualSampleRate, 48_000);
  state.releaseAcquiredAudioSource(result);
  assert.equal(result.stream.getAudioTracks()[0]!.stopped, true);
  assert.equal(state.original.stopped, false);
});

test("a live cloned capture survives stopping the previous owned track", async () => {
  const state = harness();
  const result = await state.acquireAudioSource(
    undefined,
    { echoCancellation: true, autoGainControl: true },
    state.input,
  );
  state.original.stop();
  assert.equal(result.stream.getAudioTracks()[0]!.readyState, "live");
});

test("muted, ended, changed browser DSP and absent capture always reacquire", async () => {
  for (const condition of ["muted", "ended", "aec", "agc", "missing"]) {
    const state = harness();
    if (condition === "muted") state.original.muted = true;
    if (condition === "ended") state.original.stop();
    const processing = {
      echoCancellation: condition !== "aec",
      autoGainControl: condition !== "agc",
    };
    const result = await state.acquireAudioSource(
      undefined,
      processing,
      condition === "missing" ? undefined : state.input,
    );
    assert.equal(state.requests(), 1, condition);
    assert.equal(result.stream, state.fresh);
  }
});

test("phone transport retains capture ownership through DSP disposal", async () => {
  const state = harness();
  const result = await state.acquireAudioSource(
    "phone",
    { echoCancellation: true, autoGainControl: true },
    state.input,
  );
  assert.equal(result.stream, state.input);
  assert.equal(result.stopInputOnDispose, false);
  state.releaseAcquiredAudioSource(result);
  assert.equal(state.original.stopped, false);
  assert.equal(state.requests(), 0);
});
