import assert from "node:assert/strict";
import test from "node:test";
import { ChatMixController } from "../src/main/chat-mix-controller";
import {
  ChatMixVolumeLeases,
  type ChatMixLease,
  type ChatMixSession,
} from "../src/main/chat-mix-volume-leases";

async function fixture(pendingRecovery = false) {
  let now = 0,
    available = true,
    pendingRestore = pendingRecovery,
    failAfterWrite = false;
  const own: ChatMixSession = {
    processId: 1,
    instanceId: "self",
    deviceId: "device",
    volume: 0.9,
    muted: false,
  };
  const game: ChatMixSession = { ...own, processId: 42, instanceId: "game", volume: 0.8 };
  const values: number[] = [];
  let journal: ChatMixLease[] = [];
  const backend = {
    list: async () => {
      if (!available) throw Error("offline");
      return [{ ...own }, { ...game }];
    },
    change: async (id: { processId: number }, expected: number, value: number) => {
      assert.equal(id.processId, 42, "must never modify ShangHao's own session");
      if (Math.abs(game.volume - expected) > 0.0001) return { ok: false, conflict: true };
      game.volume = value;
      values.push(value);
      if (failAfterWrite) {
        failAfterWrite = false;
        throw Error("reply lost");
      }
      return { ok: true };
    },
    isProcessAlive: () => true,
  };
  const leases = await ChatMixVolumeLeases.open(backend, {
    read: async () => journal,
    write: async (next) => {
      journal = structuredClone([...next]);
    },
  });
  const controller = new ChatMixController(
    {
      list: backend.list,
      attenuate: (...args) => leases.attenuate(...args),
      ownProcesses: () => new Set([1]),
      restore: () => (pendingRestore ? Promise.resolve({ pending: 1 }) : leases.restore()),
    },
    () => now,
  );
  await controller.tick();
  now = 100;
  return {
    controller,
    game,
    own,
    values,
    setTime: (value: number) => {
      now = value;
    },
    offline: () => {
      available = false;
    },
    online: () => {
      available = true;
    },
    uncertainWrite: () => {
      failAfterWrite = true;
    },
    blockedRestore: (value: boolean) => {
      pendingRestore = value;
    },
    async tick(at: number, speaking?: boolean) {
      now = at + 100;
      if (speaking !== undefined) controller.update({ enabled: true, inRoom: true, speaking });
      await controller.tick();
    },
    get journal() {
      return journal;
    },
  };
}

test("voice activity smoothly ducks background, preserves own voice, and restores after hangover", async () => {
  const f = await fixture();
  await f.tick(0, true);
  await f.tick(100, true);
  await f.tick(200, true);
  assert(f.values[0] > f.values[1] && f.values[1] > f.values[2]);
  assert(Math.abs(f.game.volume - 0.28) < 0.0001);
  assert.equal(f.own.volume, 0.9);
  await f.tick(500, false);
  assert(Math.abs(f.game.volume - 0.28) < 0.0001);
  for (let t = 1100; t <= 1800; t += 100) await f.tick(t, false);
  assert.equal(f.game.volume, 0.8);
  assert.equal(f.controller.getPhase(), "ready");
  assert.deepEqual(f.journal, []);
  await f.controller.stop();
});

test("speech received before the first worker tick survives startup recovery", async () => {
  let now = 100,
    changes = 0;
  const controller = new ChatMixController(
    {
      list: async () => [
        { processId: 42, instanceId: "game", deviceId: "device", volume: 0.8, muted: false },
      ],
      ownProcesses: () => new Set([1]),
      restore: async () => ({ pending: 0 }),
      attenuate: async () => {
        changes++;
        return true;
      },
    },
    () => now,
  );
  controller.update({ enabled: true, inRoom: true, speaking: true });
  await controller.tick();
  assert(changes > 0, "startup discarded the only speech pulse");
  now += 1000;
  await controller.stop();
});

test("renderer loss expires the activity lease and restores without another renderer message", async () => {
  const f = await fixture();
  await f.tick(0, true);
  await f.tick(100, true);
  for (let t = 2700; t <= 3500; t += 100) await f.tick(t);
  assert.equal(f.game.volume, 0.8);
  assert.equal(f.controller.getPhase(), "off");
  await f.controller.stop();
});

test("no eligible session and declined writes never report successful balancing", async () => {
  let now = 0,
    visible = false;
  const controller = new ChatMixController(
    {
      list: async () =>
        visible
          ? [{ processId: 42, instanceId: "game", deviceId: "device", volume: 0.8, muted: false }]
          : [],
      ownProcesses: () => new Set([1]),
      restore: async () => ({ pending: 0 }),
      attenuate: async () => false,
    },
    () => now,
  );
  controller.update({ enabled: true, inRoom: true, speaking: true });
  await controller.tick();
  assert.equal(controller.getPhase(), "waiting");
  visible = true;
  now = 1200;
  controller.update({ enabled: true, inRoom: true, speaking: true });
  await controller.tick();
  assert.equal(controller.getPhase(), "waiting");
  await controller.stop();
});

test("lost mutation reply triggers bounded automatic recovery before resuming new attenuation", async () => {
  const f = await fixture();
  f.uncertainWrite();
  await f.tick(0, true);
  assert.equal(f.controller.getPhase(), "recovering");
  assert(f.game.volume < 0.8);
  const calls = f.values.length;
  await f.tick(500, true);
  assert.equal(f.values.length, calls);
  await f.tick(1000, false);
  assert.equal(f.game.volume, 0.8);
  assert.deepEqual(f.journal, []);
  f.controller.update({ enabled: false, inRoom: true, speaking: false });
  await f.tick(1100);
  assert.equal(f.controller.getPhase(), "off");
  await f.controller.stop();
});

test("unresolved startup recovery blocks new volume writes; stopping is terminal", async () => {
  const f = await fixture(true);
  await f.tick(0, true);
  await f.tick(2000, true);
  assert.deepEqual(f.values, []);
  assert.equal(f.controller.getPhase(), "recovering");
  f.blockedRestore(false);
  await f.controller.stop();
  await f.tick(4000, true);
  assert.deepEqual(f.values, []);
});

test("manual background adjustment wins during a ramp and is not overwritten on shutdown", async () => {
  const f = await fixture();
  await f.tick(0, true);
  f.game.volume = 0.61;
  await f.tick(100, true);
  await f.tick(200, true);
  assert.equal(f.game.volume, 0.61);
  await f.controller.stop();
  assert.equal(f.game.volume, 0.61);
});

test("a slow native call is not duplicated by overlapping ticks or a concurrent stop", async () => {
  let release!: () => void,
    entered = 0,
    restored = 0,
    now = 0;
  const controller = new ChatMixController(
    {
      list: async () => {
        entered++;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return [];
      },
      attenuate: async () => {
        throw Error("unexpected attenuation");
      },
      ownProcesses: () => new Set([1]),
      restore: async () => {
        restored++;
        return { pending: 0 };
      },
    },
    () => now,
  );
  await controller.tick();
  now = 100;
  controller.update({ enabled: true, inRoom: true, speaking: true });
  const first = controller.tick();
  await new Promise((resolve) => setImmediate(resolve));
  const second = controller.tick();
  assert.equal(first, second);
  assert.equal(entered, 1);
  const stop = controller.stop();
  release();
  await Promise.all([first, second, stop]);
  assert.equal(restored, 2);
});
