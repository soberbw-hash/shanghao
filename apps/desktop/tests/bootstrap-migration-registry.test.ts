import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { BootstrapMigrationRegistry } from "../src/main/bootstrap-migration-registry";

test("bootstrap migration is marked only after success and skipped on later launches", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-bootstrap-registry-"));
  const filePath = path.join(directory, "bootstrap-migrations.json");
  try {
    let attempts = 0;
    const task = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("interrupted");
    };
    await assert.rejects(new BootstrapMigrationRegistry(filePath).runOnce("legacy_task_v1", task));
    assert.equal(
      await new BootstrapMigrationRegistry(filePath).runOnce("legacy_task_v1", task),
      true,
    );
    assert.equal(
      await new BootstrapMigrationRegistry(filePath).runOnce("legacy_task_v1", task),
      false,
    );
    assert.equal(attempts, 2);
    const state = JSON.parse(await readFile(filePath, "utf8")) as {
      completed: Record<string, string>;
    };
    assert.ok(state.completed.legacy_task_v1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
