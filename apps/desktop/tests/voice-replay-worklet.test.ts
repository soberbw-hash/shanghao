import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

test("replay audio worklet downmixes only its explicit inputs and bounds stalled-renderer PCM", () => {
  let Processor: new () => {
    port: { onmessage: (event: { data: string }) => void };
    process: (inputs: Float32Array[][]) => boolean;
  };
  const messages: (Float32Array | string)[] = [];
  vm.runInNewContext(
    readFileSync("src/renderer/src/features/recording/voiceReplay.worklet.js", "utf8"),
    {
      Float32Array,
      AudioWorkletProcessor: class {
        port = { postMessage: (data: Float32Array | string) => messages.push(data) };
      },
      registerProcessor: (_name: string, ctor: typeof Processor) => {
        Processor = ctor;
      },
    },
  );
  const node = new Processor!();
  const microphone = [new Float32Array(128).fill(0.2)];
  const remoteStereo = [new Float32Array(128).fill(0.2), new Float32Array(128).fill(0.4)];
  for (let i = 0; i < 320; i++) node.process([microphone, remoteStereo]);
  assert.equal(messages.length, 3, "two PCM blocks plus one gap, never an unbounded queue");
  const first = messages[0] as Float32Array;
  assert.ok(first.every((sample) => Math.abs(sample - 0.5) < 0.00001));
  assert.equal(messages[2], "gap");
  node.port.onmessage({ data: "ack" });
  for (let i = 0; i < 32; i++) node.process([microphone, []]);
  assert.equal(messages.length, 4);
  node.port.onmessage({ data: "stop" });
  assert.equal(node.process([microphone, remoteStereo]), false);
  assert.equal(messages.length, 4);
});
