import assert from "node:assert/strict";
import test from "node:test";

import { RelayVoiceActivityGate } from "../src/renderer/src/features/audio/RelayVoiceActivityGate";

const frame = (amplitude: number, length = 1_024): Float32Array => {
  const output = new Float32Array(length);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.sin((index / 32) * Math.PI * 2) * amplitude;
  }
  return output;
};

test("relay voice gate suppresses silence and opens with pre-roll", () => {
  const gate = new RelayVoiceActivityGate();
  for (let index = 0; index < 8; index += 1) {
    assert.equal(gate.process(frame(0.0005), 21.3).samples, undefined);
  }
  assert.equal(gate.process(frame(0.08), 21.3).samples, undefined);
  const opened = gate.process(frame(0.08), 21.3);
  assert.equal(opened.opened, true);
  assert.ok((opened.samples?.length ?? 0) > 1_024);
});

test("relay voice gate keeps a short hangover and then closes", () => {
  const gate = new RelayVoiceActivityGate();
  gate.process(frame(0.08), 21.3);
  gate.process(frame(0.08), 21.3);
  let closed = false;
  for (let index = 0; index < 20; index += 1) {
    const result = gate.process(frame(0), 21.3);
    closed ||= result.closed;
  }
  assert.equal(closed, true);
  assert.equal(gate.process(frame(0), 21.3).samples, undefined);
});

test("relay voice gate does not open for a single click transient", () => {
  const gate = new RelayVoiceActivityGate();
  const click = new Float32Array(1_024);
  click[12] = 0.9;
  assert.equal(gate.process(click, 21.3).samples, undefined);
  assert.equal(gate.process(frame(0.0005), 21.3).samples, undefined);
  assert.equal(gate.getDiagnostics().isOpen, false);
});
