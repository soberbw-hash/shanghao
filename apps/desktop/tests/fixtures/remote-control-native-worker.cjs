/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, setTimeout, console */
// Protocol failure-injection fixture. It has no OS/native input dependency.
const readline = require("node:readline");
const mode = process.env.SHANGHAO_FAKE_REMOTE_INPUT_MODE;
let current,
  floor = 0;
const emit = (value) => console.log(JSON.stringify(value));
emit({
  kind: "ready",
  protocolVersion: 1,
  supported: false,
  emergencyStopReady: false,
  dryRun: mode !== "bad-ready",
});
const lines = readline.createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  const ack = (ok) => emit({ requestId: request.requestId, ok, applied: false, dryRun: true });
  const bound = () =>
    current?.grantId === request.grantId &&
    current.generation === request.generation &&
    request.generation > floor;
  if (request.command === "begin") {
    const begin = () => {
      if (request.generation <= floor) return ack(false);
      current = request;
      ack(true);
    };
    if (mode === "delayed-begin") setTimeout(begin, 100);
    else begin();
  } else if (request.command === "revoke") {
    floor = Math.max(floor, request.generation);
    current = undefined;
    ack(true);
  } else if (request.command === "input") {
    if (mode === "stall-input") return;
    if (mode === "invalid-ack")
      return emit({ requestId: request.requestId, ok: "yes", applied: false, dryRun: true });
    if (mode === "malformed-output") return emit(null);
    ack(bound());
  } else if (request.command === "heartbeat") {
    if (mode === "safety-stop")
      emit({ kind: "revoked", reason: "emergency_stop", cleanupComplete: true });
    else ack(bound());
  } else ack(false);
});
lines.on("close", () => process.exit(0));
