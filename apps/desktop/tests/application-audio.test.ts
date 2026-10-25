import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { ApplicationAudioFrameParser } from "../src/main/application-audio-protocol";
import { ApplicationAudioService } from "../src/main/application-audio-service";

const packet = () => {
  const bytes = Buffer.alloc(32);
  bytes.write("SHAU");
  bytes.writeUInt16LE(1, 4);
  bytes.writeUInt16LE(2, 6);
  bytes.writeUInt32LE(48_000, 8);
  bytes.writeUInt32LE(2, 12);
  bytes.writeUInt32LE(7, 16);
  bytes.writeUInt32LE(8, 20);
  bytes.writeInt16LE(123, 24);
  return bytes;
};

test("application PCM survives pipe fragmentation and rejects forged allocation sizes", () => {
  const parser = new ApplicationAudioFrameParser();
  assert.deepEqual(parser.push(packet().subarray(0, 11)), []);
  const [frame] = parser.push(packet().subarray(11));
  assert.equal(frame?.sequence, 7);
  assert.equal(frame?.frames, 2);
  assert.equal(Buffer.from(frame!.data).readInt16LE(), 123);
  const forged = packet();
  forged.writeUInt32LE(0xffffffff, 20);
  assert.throws(() => parser.push(forged), /invalid_audio_frame/);
});

class FakeCapture extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;
  commands = "";
  constructor() {
    super();
    this.stdin.on("data", (chunk) => {
      this.commands += chunk.toString();
      if (this.commands.includes("stop\n")) {
        this.exitCode = 0;
        this.emit("close", 0);
      }
    });
  }
  kill() {
    this.killed = true;
    this.exitCode = 1;
    this.emit("close", 1);
    return true;
  }
  ready() {
    this.stderr.write('{"type":"ready","sampleRate":48000,"channels":2,"format":"s16le"}\n');
  }
}

const fixture = () => {
  const child = new FakeCapture();
  let spawns = 0;
  const rows = [{ pid: 9200, creationTime: "1234567", processName: "player.exe", name: "Player" }];
  const service = new ApplicationAudioService({
    executablePath: "unused-test-executable",
    isWindows: true,
    listNativeSources: async () => rows,
    spawnCapture: () => {
      spawns++;
      return child as never;
    },
    startupTimeoutMs: 100,
    stopTimeoutMs: 40,
  });
  return { child, service, rows, spawns: () => spawns };
};

test("application source ids are opaque and PID reuse is rejected before spawn", async () => {
  const f = fixture();
  const { sources } = await f.service.listSources();
  assert.ok(sources[0]?.id);
  assert.equal(Object.hasOwn(sources[0]!, "pid"), false);
  f.rows[0]!.creationTime = "7654321";
  await assert.rejects(f.service.start(sources[0]!.id), /source_identity_changed/);
  assert.equal(f.spawns(), 0);
  await assert.rejects(f.service.start("9200"), /source_missing/);
});

test("sharing starts only after native ready and stop drops every later PCM packet", async () => {
  const f = fixture();
  const { sources } = await f.service.listSources();
  const frames: number[] = [];
  let resolved = false;
  const pending = f.service.start(sources[0]!.id, {
    onPcm: (frame) => frames.push(frame.sequence),
  });
  void pending.then(() => {
    resolved = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(resolved, false);
  f.child.ready();
  const session = await pending;
  assert.equal(session.format, "s16le");
  f.child.stdout.write(packet());
  assert.deepEqual(frames, [7]);
  assert.equal(f.service.setGain(session.sessionId, 0.4).gain, 0.4);
  assert.throws(() => f.service.setGain(session.sessionId, NaN), /invalid_audio_gain/);
  await f.service.stop(session.sessionId);
  f.child.stdout.write(packet());
  assert.deepEqual(frames, [7]);
  assert.match(f.child.commands, /stop\n/);
});

test("stop during source revalidation cannot launch a late capture", async () => {
  let finish!: () => void;
  let calls = 0;
  let spawns = 0;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const service = new ApplicationAudioService({
    executablePath: "unused",
    isWindows: true,
    listNativeSources: async () => {
      if (++calls > 1) await gate;
      return [{ pid: 99, creationTime: "12", processName: "player.exe", name: "Player" }];
    },
    spawnCapture: () => {
      spawns++;
      return new FakeCapture() as never;
    },
  });
  const { sources } = await service.listSources();
  const pending = service.start(sources[0]!.id);
  await service.stop();
  finish();
  await assert.rejects(pending, /superseded/);
  assert.equal(spawns, 0);
});

test("activation timeout kills the helper and reports failure without fabricated ready", async () => {
  const f = fixture();
  const { sources } = await f.service.listSources();
  await assert.rejects(f.service.start(sources[0]!.id), /activation_timeout/);
  assert.equal(f.child.killed, true);
});

test("old Windows builds never enumerate or spawn and internal applications stay out of the picker", async () => {
  let enumerated = false;
  const old = new ApplicationAudioService({
    executablePath: "unused",
    isWindows: true,
    windowsBuild: 19045,
    listNativeSources: async () => {
      enumerated = true;
      return [];
    },
  });
  assert.deepEqual(await old.listSources(), { supported: false, sources: [] });
  await assert.rejects(old.start("anything"), /unsupported_os/);
  assert.equal(enumerated, false);
  const f = fixture();
  f.rows.push({ pid: process.pid, creationTime: "1", processName: "Player.exe", name: "Self" });
  f.rows.push({ pid: 123, creationTime: "2", processName: "electron.exe", name: "Internal" });
  f.rows.push({ pid: 124, creationTime: "3", processName: "explorer.exe", name: "System" });
  assert.equal((await f.service.listSources()).sources.length, 1);
});

test("native activation errors preserve their classification and ready cannot resurrect a failed session", async () => {
  const f = fixture();
  const { sources } = await f.service.listSources();
  const states: string[] = [];
  const pending = f.service.start(sources[0]!.id, {
    onState: (state) => states.push(`${state.phase}:${state.code ?? ""}`),
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.child.stderr.write('{"type":"error","code":"capture_format_unsupported"}\n');
  await assert.rejects(pending, /capture_format_unsupported/);
  f.child.ready();
  assert.deepEqual(states, ["starting:", "error:capture_format_unsupported"]);
  assert.equal(f.child.killed, true);
});

test("aborting during native activation sends stop and rejects the start", async () => {
  const f = fixture();
  const { sources } = await f.service.listSources();
  const abort = new AbortController();
  const pending = f.service.start(sources[0]!.id, { signal: abort.signal });
  await new Promise<void>((resolve) => setImmediate(resolve));
  abort.abort();
  await assert.rejects(pending, /application_audio_stopped/);
  assert.match(f.child.commands, /stop\n/);
});

test("unexpected channel changes terminate capture instead of relabeling its samples", async () => {
  const f = fixture();
  const { sources } = await f.service.listSources();
  const states: string[] = [];
  const pending = f.service.start(sources[0]!.id, { onState: (state) => states.push(state.phase) });
  await new Promise<void>((resolve) => setImmediate(resolve));
  f.child.ready();
  await pending;
  const mono = packet();
  mono.writeUInt16LE(1, 6);
  mono.writeUInt32LE(4, 12);
  f.child.stdout.write(mono);
  assert.equal(f.child.killed, true);
  assert.deepEqual(states, ["starting", "sharing", "error"]);
});
