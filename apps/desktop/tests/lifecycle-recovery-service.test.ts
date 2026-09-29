import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(
  readFileSync(new URL("../src/main/lifecycle-recovery-service.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

test("Windows lifecycle reconciliation reports a failure without an unhandled rejection", async () => {
  const powerMonitor = new EventEmitter();
  const screen = new EventEmitter();
  const module = {
    exports: {} as {
      LifecycleRecoveryService: new (...args: unknown[]) => {
        start(): void;
        stop(): void;
      };
    },
  };
  runInNewContext(source, {
    exports: module.exports,
    require: (id: string) => {
      if (id === "electron") return { powerMonitor, screen };
      throw new Error(`Unexpected dependency: ${id}`);
    },
    setTimeout,
    clearTimeout,
  });
  const logs: Array<{ message: string }> = [];
  const service = new module.exports.LifecycleRecoveryService(
    async () => {
      throw new Error("display unavailable");
    },
    async (payload: { message: string }) => {
      logs.push(payload);
    },
  );
  service.start();
  powerMonitor.emit("resume");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(
    logs.map((item) => item.message),
    ["lifecycle_reconcile", "lifecycle_reconcile_failed"],
  );
  service.stop();
});
