import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

import { terminateProcessTree } from "../src/main/process-tree";

test("process-tree termination resolves only after the child exits", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    windowsHide: true,
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });

  await terminateProcessTree(child, 5_000);
  assert.notEqual(child.exitCode ?? child.signalCode, null);
});
