import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

test("native phone input rejects malformed and stale samples and retires listeners without releasing privacy", () => {
  const children: (EventEmitter & {
    stdout: PassThrough;
    stdin: PassThrough;
    stderr: PassThrough;
    kill: () => void;
  })[] = [];
  const availability: boolean[] = [],
    samples: unknown[] = [];
  const exports = {} as {
    PhoneInputMonitor: new (...args: unknown[]) => {
      configure: (value: unknown) => void;
      stop: () => void;
    };
  };
  const source = ts.transpileModule(
    readFileSync(new URL("../src/main/phone-input-monitor.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    },
  ).outputText;
  runInNewContext(source, {
    exports,
    process: { resourcesPath: "/resources" },
    Date,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    require: (id: string) => {
      if (id === "node:path") return path;
      if (id === "node:readline") return { createInterface };
      if (id === "electron") return { app: { isPackaged: true } };
      if (id === "./platform/PlatformService") return { platformService: { isWindows: true } };
      if (id === "node:child_process")
        return {
          spawn: (executable: string) => {
            assert.match(executable, /ShangHao.PhoneInput.exe$/);
            const child = Object.assign(new EventEmitter(), {
              stdout: new PassThrough(),
              stdin: new PassThrough(),
              stderr: new PassThrough(),
              kill() {},
            });
            children.push(child);
            return child;
          },
        };
      throw new Error(id);
    },
  });
  const cutoff = Date.now();
  const monitor = new exports.PhoneInputMonitor(
    (value: boolean) => availability.push(value),
    (sampledAt: number) => sampledAt > cutoff,
  );
  try {
    monitor.configure({
      virtualKey: 40,
      synchronizePhysical: (value: unknown) => samples.push(value),
    });
    const child = children[0]!;
    const send = (value: unknown) => child.stdout.write(JSON.stringify(value) + "\n");
    send({ down: true }); // No ready handshake, no fabricated transition.
    send({ ready: true });
    assert.equal(availability.at(-1), true);
    send({
      down: "true",
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      sampledAt: Date.now() + 1,
    });
    const sample = { down: true, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
    send({ ...sample, sampledAt: cutoff - 1 });
    assert.equal(samples.length, 0);
    send({ ...sample, sampledAt: Date.now() + 1 });
    assert.equal(samples.length, 1);
    monitor.stop();
    send({ ...sample, down: false, sampledAt: Date.now() + 2 });
    assert.equal(samples.length, 1, "shutdown cannot synthesize a release");
    assert.equal(availability.at(-1), false);
  } finally {
    monitor.stop();
  }
});
