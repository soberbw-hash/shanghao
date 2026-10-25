/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, console, setTimeout, clearTimeout */
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const path = require("node:path");
const assert = require("node:assert/strict");

// Read-only native integration: registers an unused F24 binding. Does not inject
// keys, read microphone data, or modify the real application's configuration.
const executable = path.resolve(process.argv[2]);
const child = spawn(executable, [], { windowsHide: true, stdio: "pipe" });
const lines = createInterface({ input: child.stdout });
let ready = false,
  desktopStatus = false,
  privilegeStatus = false;
let stderr = "";
const deadline = setTimeout(() => {
  child.kill();
  process.exitCode = 1;
}, 6000);
child.stderr.on("data", (chunk) => {
  stderr += String(chunk).slice(0, 512);
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
lines.on("line", (line) => {
  const value = JSON.parse(line);
  if (value.ready === true) {
    assert.equal(value.rawInput, true, "Windows background Raw Input registration");
    ready = true;
  }
  if (typeof value.inputDesktopAvailable === "boolean") desktopStatus = true;
  if (Object.hasOwn(value, "foregroundHigher")) privilegeStatus = true;
  if (ready && desktopStatus && privilegeStatus) child.stdin.end();
});
child.once("exit", (code) => {
  clearTimeout(deadline);
  lines.close();
  assert.equal(code, 0, stderr);
  assert.equal(ready && desktopStatus && privilegeStatus, true);
  console.log(
    JSON.stringify({
      rawInputRegistered: ready,
      desktopStatus,
      privilegeStatus,
      systemInputInjected: false,
      audioDevicesModified: false,
    }),
  );
});
child.stdin.on("error", () => {});
child.stdin.write(JSON.stringify({ virtualKey: 0x87 }) + "\n");
