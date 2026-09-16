import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { PassThrough, Writable } from "node:stream";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { IPC_CHANNELS } from "@private-voice/shared";

test("phone service stays muted on native rejection, wrong acknowledgement and helper crash", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const publications: { active: boolean; busy: boolean; error?: string }[] = [];
  const commands: { id: number; active: boolean }[] = [];
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    getAppPath: () => "/test",
    getPath: () => "/test",
  });
  const power = new EventEmitter();
  const frame = {};
  const window = { webContents: { id: 1, mainFrame: frame } };
  let failure: "error" | "mismatch" | undefined;
  let child: EventEmitter;
  let spawns = 0;
  const spawn = () => {
    spawns++;
    const stdout = new PassThrough();
    child = Object.assign(new EventEmitter(), {
      stdout,
      stderr: new PassThrough(),
      stdin: new Writable({
        write(chunk, _encoding, done) {
          const request = JSON.parse(String(chunk));
          commands.push(request);
          const response = {
            id: request.id,
            active: failure === "mismatch" ? !request.active : request.active,
            error: failure === "error" ? "native mute failed" : undefined,
          };
          queueMicrotask(() => stdout.write(JSON.stringify(response) + "\n"));
          done();
        },
      }),
    });
    queueMicrotask(() => stdout.write(JSON.stringify({ ready: true, active: false }) + "\n"));
    return child;
  };
  const exports = {} as { registerPhoneMode: (...args: unknown[]) => void };
  const source = ts.transpileModule(
    readFileSync(new URL("../src/main/phone-mode-service.ts", import.meta.url), "utf8"),
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
    setTimeout,
    clearTimeout,
    setImmediate,
    require: (id: string) => {
      if (id === "node:child_process") return { spawn };
      if (id === "node:path") return path;
      if (id === "node:readline") return { createInterface };
      if (id === "electron")
        return {
          app,
          powerMonitor: power,
          ipcMain: {
            handle: (name: string, callback: (...args: unknown[]) => unknown) =>
              handlers.set(name, callback),
          },
        };
      if (id === "@private-voice/shared") return { IPC_CHANNELS };
      if (id === "./safe-web-contents")
        return {
          sendToWindow: (
            _window: unknown,
            _channel: unknown,
            state: (typeof publications)[number],
          ) => publications.push(state),
        };
      if (id === "./platform/PlatformService") return { platformService: { isWindows: true } };
      throw new Error(id);
    },
  });
  const settings = { pushToTalkShortcut: "Space", isPushToTalkEnabled: false };
  exports.registerPhoneMode(
    () => window,
    { getSnapshot: () => settings, save: async () => undefined },
    {
      configurePhone: () => undefined,
      resetPhonePress: () => undefined,
    },
  );
  const event = { sender: window.webContents, senderFrame: frame };
  const configure = async () =>
    handlers.get(IPC_CHANNELS.phoneMode.configure)!(event, "Space", "hold");
  await configure(); // An inactive default push-to-talk key must not reserve Space.
  settings.isPushToTalkEnabled = true;
  await assert.rejects(configure(), /按键说话/);
  const set = async (active: boolean) => handlers.get(IPC_CHANNELS.phoneMode.set)!(event, active);
  for (const mode of ["error", "mismatch"] as const) {
    failure = mode;
    await assert.rejects(set(true));
    assert.equal(publications.at(-1)?.active, true);
    assert.ok(publications.at(-1)?.error);
    assert.equal(commands.at(-1)?.active, true);
  }
  failure = undefined;
  await set(true);
  const commandCount = commands.length;
  power.emit("lock-screen");
  power.emit("suspend");
  assert.equal(commands.length, commandCount, "lock/suspend cannot silently unmute");
  child!.emit("exit", 1);
  assert.equal(publications.at(-1)?.active, true);
  assert.ok(publications.at(-1)?.error);
  assert.equal(spawns, 1, "a crash cannot auto-restart into journal restoration");
});
