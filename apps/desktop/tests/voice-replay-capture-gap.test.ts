import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { VoiceReplaySession } from "../src/renderer/src/features/recording/voiceReplaySession";

test("a reported PCM gap prevents saving old audio until fresh contiguous samples arrive", async () => {
  // Substitute only the WebAudio boundary and Vite URL import; run the production capture class.
  const source = readFileSync(
    "src/renderer/src/features/recording/VoiceReplayCapture.ts",
    "utf8",
  ).replace(/^import .*;\r?\n/gm, "");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const nodes: FakeNode[] = [];
  let now = 100,
    closed = false;
  class FakeNode {
    port = {
      onmessage: undefined as undefined | ((event: { data: Float32Array | string }) => void),
      postMessage() {},
      close() {},
    };
    constructor() {
      nodes.push(this);
    }
    connect() {}
    disconnect() {}
  }
  const exports: Record<string, unknown> = {};
  vm.runInNewContext(compiled, {
    exports,
    VoiceReplaySession,
    Float32Array,
    workletUrl: "synthetic-worklet",
    performance: { now: () => now },
    AudioWorkletNode: FakeNode,
    MediaStream: class {},
    AudioContext: class {
      sampleRate = 48000;
      destination = {};
      audioWorklet = { addModule: async () => {} };
      createMediaStreamSource() {
        return { connect() {}, disconnect() {} };
      }
      async resume() {}
      async close() {
        closed = true;
      }
    },
  });
  const Capture = exports.VoiceReplayCapture as new (...args: unknown[]) => {
    start: (...args: unknown[]) => Promise<void>;
    snapshot: (seconds: number) => Uint8Array;
    close: () => void;
  };
  const capture = new Capture({ enabled: true, members: ["a"], approved: ["a"] }, () => true);
  try {
    await capture.start({}, {});
    const node = nodes[0]!;
    node.port.onmessage!({ data: new Float32Array(4096).fill(0.2) });
    assert.equal(capture.snapshot(15).length, 44 + 4096 * 2);
    now += 100;
    node.port.onmessage!({ data: "gap" });
    assert.throws(
      () => capture.snapshot(15),
      /voice_replay_audio_stale/,
      "a recent timestamp cannot make a known dropped-block history safe to save",
    );
    now += 100;
    node.port.onmessage!({ data: new Float32Array(4096).fill(0.4) });
    const recovered = capture.snapshot(15);
    assert.equal(
      recovered.length,
      44 + 4096 * 2,
      "pre-gap samples must not be joined across the gap",
    );
    const pcm = new DataView(recovered.buffer, recovered.byteOffset, recovered.byteLength);
    assert.ok(pcm.getInt16(44, true) > 12000, "recovered clip contains only the new samples");
    capture.close();
    assert.throws(() => capture.snapshot(15), /voice_replay_not_authorized/);
    assert.equal(closed, true);
  } finally {
    capture.close();
  }
});
