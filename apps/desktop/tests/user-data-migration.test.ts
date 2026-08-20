import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ensurePre30DataSnapshot } from "../src/main/user-data-migration";

test("pre-3.0 snapshot stages, verifies, commits once, and includes control metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-migration-"));
  const userDataDirectory = path.join(root, "user-data");
  const recordingDirectory = path.join(root, "recordings");
  try {
    await import("node:fs/promises").then(({ mkdir }) =>
      Promise.all([
        mkdir(userDataDirectory, { recursive: true }),
        mkdir(recordingDirectory, { recursive: true }),
      ]),
    );
    await writeFile(path.join(userDataDirectory, "settings.json"), '{"theme":"light"}', "utf8");
    await writeFile(
      path.join(recordingDirectory, ".shanghao-library.json"),
      '{"favorites":[]}',
      "utf8",
    );
    await ensurePre30DataSnapshot({ userDataDirectory, recordingDirectory });
    await ensurePre30DataSnapshot({ userDataDirectory, recordingDirectory });

    const snapshotRoot = path.join(userDataDirectory, "migration-snapshots");
    const names = await readdir(snapshotRoot);
    const committed = names.filter(
      (name) => name.startsWith("pre-3.0-recording-identity-v1-") && !name.endsWith(".json"),
    );
    assert.equal(committed.length, 1);
    const marker = JSON.parse(
      await readFile(
        path.join(snapshotRoot, "pre-3.0-recording-identity-v1.complete.json"),
        "utf8",
      ),
    ) as { entries: Array<{ source: string; sha256: string }> };
    assert.equal(
      marker.entries.some((entry) => entry.source.endsWith("settings.json")),
      true,
    );
    assert.equal(
      marker.entries.some((entry) => entry.source.endsWith(".shanghao-library.json")),
      true,
    );
    assert.equal(
      marker.entries.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
