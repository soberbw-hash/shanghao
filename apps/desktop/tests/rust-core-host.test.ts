import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { RustCoreClient } from "../src/main/rust-core-client";

test("Rust Core host shares a process, maps concurrent replies, and recovers one crash", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-core-host-"));
  const script = path.join(directory, "core.cjs");
  const crashMarker = path.join(directory, "crashed-once");
  await writeFile(
    script,
    [
      "const fs = require('node:fs');",
      "const readline = require('node:readline');",
      "const marker = process.argv[2];",
      "const lines = readline.createInterface({ input: process.stdin });",
      "lines.on('line', (line) => {",
      "  const request = JSON.parse(line);",
      "  if (request.path === 'crash-once' && !fs.existsSync(marker)) {",
      "    fs.writeFileSync(marker, '1'); process.exit(7);",
      "  }",
      "  if (request.path === 'hang') return;",
      "  const result = { stableId: `${request.path}:${process.pid}` };",
      "  setTimeout(() => process.stdout.write(JSON.stringify({ request_id: request.request_id, ok: true, result }) + '\\n'), request.path === 'slow' ? 40 : 0);",
      "});",
    ].join("\n"),
  );
  const client = new RustCoreClient(process.execPath, [script, crashMarker]);
  try {
    const [slow, fast] = await Promise.all([
      client.fileIdentity("slow"),
      client.fileIdentity("fast"),
    ]);
    assert.match(slow.stableId, /^slow:\d+$/);
    assert.equal(slow.stableId.split(":")[1], fast.stableId.split(":")[1]);
    assert.match((await client.fileIdentity("crash-once")).stableId, /^crash-once:\d+$/);
    await assert.rejects(client.fileIdentity("hang", { timeoutMs: 150 }), /rust_core_timeout/);
    assert.match((await client.fileIdentity("after-timeout")).stableId, /^after-timeout:\d+$/);
  } finally {
    client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
