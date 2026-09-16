import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyLocalModelRuntimeError,
  LocalModelRuntimeError,
} from "../src/main/local-model-runtime";

test("MOSS decode limit is truncation, not a worker crash", () => {
  assert.equal(
    classifyLocalModelRuntimeError(
      new Error(
        "transcribe_run: output truncated: decode hit the context/generation cap before end-of-stream (status 18)",
      ),
    ),
    "output_truncated",
  );
  assert.equal(classifyLocalModelRuntimeError("output_truncated"), "output_truncated");
});

test("existing concrete runtime errors keep their classification", () => {
  assert.equal(classifyLocalModelRuntimeError(new Error("worker exited code 1")), "crash");
  assert.equal(classifyLocalModelRuntimeError(new Error("asr_timeout")), "timeout");
  assert.equal(classifyLocalModelRuntimeError(new Error("empty_output")), "empty_output");
  assert.equal(
    classifyLocalModelRuntimeError(new LocalModelRuntimeError("parse_failed")),
    "parse_failed",
  );
});
