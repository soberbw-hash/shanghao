import assert from "node:assert/strict";
import test from "node:test";

import { runLocalProcess } from "../src/main/local-process";

test("long child process output retains bounded tails", async () => {
  const result = await runLocalProcess(
    process.execPath,
    [
      "-e",
      "process.stdout.write('a'.repeat(2*1024*1024)+'END');process.stderr.write('b'.repeat(256*1024)+'ERR')",
    ],
    { timeoutMs: 10_000 },
  );
  assert.equal(result.stdout.length, 1024 * 1024);
  assert.ok(result.stdout.endsWith("END"));
  assert.equal(result.stderr.length, 64 * 1024);
  assert.ok(result.stderr.endsWith("ERR"));
});
