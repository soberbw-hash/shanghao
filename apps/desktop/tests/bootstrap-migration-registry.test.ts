import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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

test("concurrent startup migrations preserve both completion records and run each key once", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-bootstrap-parallel-"));
  const filePath = path.join(directory, "bootstrap-migrations.json");
  try {
    const registry = new BootstrapMigrationRegistry(filePath);
    let firstRuns = 0;
    const results = await Promise.all([
      registry.runOnce("first_v1", async () => {
        firstRuns += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }),
      registry.runOnce("second_v1", async () => undefined),
      registry.runOnce("first_v1", async () => {
        firstRuns += 1;
      }),
    ]);
    assert.deepEqual(results, [true, true, false]);
    assert.equal(firstRuns, 1);
    const state = JSON.parse(await readFile(filePath, "utf8")) as {
      completed: Record<string, string>;
    };
    assert.deepEqual(Object.keys(state.completed).sort(), ["first_v1", "second_v1"]);
    assert.deepEqual(await readdir(directory), ["bootstrap-migrations.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("invalid migration records remain untouched and cannot be replaced", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-bootstrap-invalid-"));
  const filePath = path.join(directory, "bootstrap-migrations.json");
  try {
    await writeFile(filePath, '{"schemaVersion":1,"completed":[]}', "utf8");
    let ran = false;
    await assert.rejects(
      new BootstrapMigrationRegistry(filePath).runOnce("new_task_v1", async () => {
        ran = true;
      }),
      { message: "invalid_bootstrap_migration_registry" },
    );
    assert.equal(ran, false);
    assert.equal(await readFile(filePath, "utf8"), '{"schemaVersion":1,"completed":[]}');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
