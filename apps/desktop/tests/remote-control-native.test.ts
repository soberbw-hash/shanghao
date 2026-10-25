import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { RemoteControlNativeInput } from "../src/main/remote-control-native";
import type { RemoteControlNativeCommand } from "../../../packages/shared/src/types/remote-control.types";

const command = (generation = 1): RemoteControlNativeCommand => ({
  grantId: "grant-test",
  generation,
  event: { kind: "key", code: "ControlLeft", pressed: true, repeat: false },
});
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fixture = (t: TestContext, mode = "normal") => {
  const requests: Record<string, unknown>[] = [];
  const safety: string[] = [];
  const client = new RemoteControlNativeInput({
    executablePath: "trusted-fixture-only",
    mode: "dry-run",
    onSafetyStop: (reason) => {
      safety.push(reason);
    },
    spawnWorker: ((_file: string, _args: string[], options: Parameters<typeof spawn>[2]) => {
      const child = spawn(
        process.execPath,
        [path.resolve("tests/fixtures/remote-control-native-worker.cjs")],
        {
          ...options,
          env: { ...process.env, SHANGHAO_FAKE_REMOTE_INPUT_MODE: mode },
          stdio: "pipe",
          windowsHide: true,
        },
      );
      const nativeWrite = child.stdin.write.bind(child.stdin);
      child.stdin.write = ((chunk: string, ...args: unknown[]) => {
        requests.push(JSON.parse(String(chunk)) as Record<string, unknown>);
        return (nativeWrite as (...input: unknown[]) => boolean)(chunk, ...args);
      }) as typeof child.stdin.write;
      return child;
    }) as typeof spawn,
  });
  t.after(() => client.dispose());
  return { client, requests, safety };
};

test("dedicated dry-run worker never reports simulated events as actual OS execution", async (t) => {
  const f = fixture(t);
  assert.deepEqual(await f.client.prepare(), {
    supported: false,
    emergencyStopReady: false,
    dryRun: true,
  });
  const simulated = await f.client.simulateForTest(command());
  assert.equal(simulated.ok, true);
  assert.equal(simulated.applied, false);
  assert.equal(await f.client.execute(command()), false);
  assert.equal(f.requests.filter((request) => request.command === "begin").length, 1);
  assert.equal(f.requests.filter((request) => request.command === "input").length, 2);
});

test("revoke invalidates synchronously; only a new generation can begin after release", async (t) => {
  const f = fixture(t);
  await f.client.prepare();
  assert.equal((await f.client.simulateForTest(command())).ok, true);
  f.client.invalidateAndRelease({
    grantId: "grant-test",
    generation: 1,
    keys: ["ControlLeft"],
    buttons: [],
    reason: "pause",
  });
  assert.equal((await f.client.simulateForTest(command())).ok, false);
  assert.equal((await f.client.simulateForTest(command(3))).ok, true);
  assert.equal(f.requests.filter((request) => request.command === "revoke").length, 1);
  assert.equal(f.safety.length, 0);
});

test("late begin acknowledgement cannot send input after local revocation", async (t) => {
  const f = fixture(t, "delayed-begin");
  await f.client.prepare();
  const pending = f.client.simulateForTest(command());
  await pause(10);
  f.client.invalidateAndRelease({
    grantId: "grant-test",
    generation: 1,
    keys: [],
    buttons: [],
    reason: "emergency",
  });
  assert.equal((await pending).ok, false);
  assert.equal(
    f.requests.some((request) => request.command === "input"),
    false,
  );
});

test("native ACK deadline releases the pipe without retrying a non-idempotent input", async (t) => {
  const f = fixture(t, "stall-input");
  await f.client.prepare();
  const started = performance.now();
  assert.equal((await f.client.simulateForTest(command())).ok, false);
  assert.ok(performance.now() - started < 700);
  assert.equal(f.requests.filter((request) => request.command === "input").length, 1);
  assert.deepEqual(f.safety, ["native_ack_timeout"]);
});

test("malformed native output and ACK shape settle every waiter and fail closed", async (t) => {
  for (const mode of ["invalid-ack", "malformed-output"]) {
    const f = fixture(t, mode);
    await f.client.prepare();
    assert.equal((await f.client.simulateForTest(command())).ok, false);
    assert.equal(f.safety.length, 1);
  }
  const bad = fixture(t, "bad-ready");
  await assert.rejects(bad.client.prepare(), /read_only/);
});

test("bounded native queue rejects overload and never pumps stale work after failure", async (t) => {
  const f = fixture(t, "stall-input");
  await f.client.prepare();
  const pending = Array.from({ length: 16 }, () => f.client.simulateForTest(command()));
  const overflow = await f.client.simulateForTest(command());
  assert.equal(overflow.ok, false);
  assert.equal(overflow.errorCode, "native_queue_full");
  await Promise.all(pending);
  assert.equal(f.requests.filter((request) => request.command === "input").length, 1);
});

test("worker emergency/lease event reaches Main without waiting for a new remote input", async (t) => {
  const f = fixture(t, "safety-stop");
  await f.client.prepare();
  assert.equal((await f.client.simulateForTest(command())).ok, true);
  await pause(300);
  assert.deepEqual(f.safety, ["native_safety_stop"]);
});

test(
  "compiled Rust worker exercises fixed events, release and generation only in dry-run",
  {
    skip: !process.env.SHANGHAO_REMOTE_INPUT_TEST_EXE,
  },
  async (t) => {
    const safety: string[] = [];
    const client = new RemoteControlNativeInput({
      executablePath: process.env.SHANGHAO_REMOTE_INPUT_TEST_EXE!,
      mode: "dry-run",
      onSafetyStop: (reason) => {
        safety.push(reason);
      },
    });
    t.after(() => client.dispose());
    const capability = await client.prepare();
    assert.equal(capability.dryRun, true);
    assert.equal(capability.supported, false);
    assert.equal((await client.simulateForTest(command())).ok, true);
    const up = command();
    up.event = { kind: "key", code: "ControlLeft", pressed: false, repeat: false };
    assert.equal((await client.simulateForTest(up)).ok, true);
    const text = command();
    text.event = { kind: "text", text: "中文🙂" };
    assert.equal((await client.simulateForTest(text)).ok, true);
    const pointer = command();
    pointer.event = {
      kind: "pointer",
      xPhysical: -1920,
      yPhysical: 1079,
      xDip: -1280,
      yDip: 719,
      absoluteX: 0,
      absoluteY: 65535,
    };
    assert.equal((await client.simulateForTest(pointer)).ok, true);
    client.invalidateAndRelease({
      grantId: "grant-test",
      generation: 1,
      keys: [],
      buttons: [],
      reason: "pause",
    });
    assert.equal((await client.simulateForTest(command(3))).ok, true);
    assert.equal(await client.execute(command(3)), false);
    assert.equal(safety.length, 0);
  },
);

const dryRustWorker = async (t: TestContext, parentPid = process.pid) => {
  const child = spawn(
    process.env.SHANGHAO_REMOTE_INPUT_TEST_EXE!,
    ["--remote-input-worker", "--parent-pid", String(parentPid), "--dry-run"],
    { windowsHide: true, stdio: "pipe" },
  );
  const received: Record<string, unknown>[] = [];
  let buffer = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      received.push(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>);
      buffer = buffer.slice(newline + 1);
    }
  });
  child.stderr.resume();
  const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
  t.after(() => {
    child.stdin.end();
    if (child.exitCode === null) child.kill();
  });
  const waitFor = async (
    predicate: (message: Record<string, unknown>) => boolean,
    timeout = 1800,
  ) => {
    const deadline = performance.now() + timeout;
    while (performance.now() < deadline) {
      const message = received.find(predicate);
      if (message) return message;
      await pause(5);
    }
    throw Error("dry_run_worker_response_timeout");
  };
  const ready = await waitFor((message) => message.kind === "ready");
  assert.equal(ready.dryRun, true);
  assert.equal(ready.supported, false);
  const send = async (requestId: string, fields: Record<string, unknown>) => {
    child.stdin.write(JSON.stringify({ requestId, ...fields }) + "\n");
    return waitFor((message) => message.requestId === requestId);
  };
  return { child, exited, send, waitFor };
};

test(
  "Rust dry-run lease watchdog releases simulated held input without Main heartbeats",
  {
    skip: !process.env.SHANGHAO_REMOTE_INPUT_TEST_EXE,
  },
  async (t) => {
    const worker = await dryRustWorker(t);
    const binding = { grantId: "lease-test", generation: 1 };
    assert.equal((await worker.send("begin", { command: "begin", ...binding })).ok, true);
    assert.equal(
      (await worker.send("down", { command: "input", ...binding, event: command().event })).ok,
      true,
    );
    const revoked = await worker.waitFor((message) => message.kind === "revoked");
    assert.equal(revoked.reason, "lease_expired");
    assert.equal(revoked.cleanupComplete, true);
    assert.equal(
      (await worker.send("old", { command: "input", ...binding, event: command().event })).ok,
      false,
    );
    worker.child.stdin.end();
    assert.equal(await worker.exited, 0);
  },
);

test(
  "Rust dry-run EOF cleans a simulated drag/key lease before process exit",
  {
    skip: !process.env.SHANGHAO_REMOTE_INPUT_TEST_EXE,
  },
  async (t) => {
    const worker = await dryRustWorker(t);
    const binding = { grantId: "eof-test", generation: 1 };
    await worker.send("begin", { command: "begin", ...binding });
    await worker.send("down", { command: "input", ...binding, event: command().event });
    const started = performance.now();
    worker.child.stdin.end();
    assert.equal(await worker.exited, 0);
    assert.ok(performance.now() - started < 1000);
  },
);

test(
  "Rust dry-run parent process handle watchdog exits when its isolated parent disappears",
  {
    skip: !process.env.SHANGHAO_REMOTE_INPUT_TEST_EXE,
  },
  async (t) => {
    const parent = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      windowsHide: true,
      stdio: "ignore",
    });
    t.after(() => {
      if (parent.exitCode === null) parent.kill();
    });
    const worker = await dryRustWorker(t, parent.pid!);
    const binding = { grantId: "parent-test", generation: 1 };
    await worker.send("begin", { command: "begin", ...binding });
    await worker.send("down", { command: "input", ...binding, event: command().event });
    parent.kill();
    assert.equal(await worker.exited, 0);
  },
);
