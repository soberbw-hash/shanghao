import assert from "node:assert/strict";
import test from "node:test";
import {
  ChatMixVolumeLeases,
  type ChatMixLease,
  type ChatMixSession,
} from "../src/main/chat-mix-volume-leases";

const fixture = () => {
  const session: ChatMixSession = {
    deviceId: "device",
    instanceId: "instance",
    processId: 42,
    volume: 0.8,
    muted: false,
  };
  let saved: ChatMixLease[] = [],
    visible = true,
    alive = true,
    failSave = false,
    failAfterWrite = false;
  const writes: number[] = [];
  const backend = {
    list: async () => (visible ? [{ ...session }] : []),
    isProcessAlive: () => alive,
    change: async (_target: unknown, expected: number, value: number) => {
      if (Math.abs(session.volume - expected) > 0.0001) return { ok: false, conflict: true };
      assert.equal(saved.length, 1, "journal must precede every external volume write");
      session.volume = value;
      writes.push(value);
      if (failAfterWrite) throw Error("synthetic pipe loss after applying volume");
      return { ok: true };
    },
  };
  const journal = {
    read: async () => structuredClone(saved),
    write: async (next: readonly ChatMixLease[]) => {
      if (failSave) throw Error("synthetic disk failure");
      saved = structuredClone([...next]);
    },
  };
  return {
    session,
    backend,
    journal,
    writes,
    get saved() {
      return saved;
    },
    hide: () => {
      visible = false;
    },
    show: () => {
      visible = true;
    },
    exit: () => {
      alive = false;
    },
    diskFailure: () => {
      failSave = true;
    },
    pipeFailure: (value: boolean) => {
      failAfterWrite = value;
    },
  };
};

test("attenuation uses the original baseline, excludes own processes, and restores exact volume", async () => {
  const f = fixture(),
    owner = await ChatMixVolumeLeases.open(f.backend, f.journal);
  assert.equal(await owner.attenuate(f.session, 0.5, new Set([42])), false);
  assert.deepEqual(f.writes, []);
  await owner.attenuate(f.session, 0.5, new Set());
  await owner.attenuate(f.session, 0.25, new Set());
  assert.deepEqual(f.writes, [0.4, 0.2], "must not repeatedly multiply an already reduced volume");
  await owner.restore();
  assert.equal(f.session.volume, 0.8);
  assert.deepEqual(f.saved, []);
});

test("manual changes win and the same session is not immediately ducked again", async () => {
  const f = fixture(),
    owner = await ChatMixVolumeLeases.open(f.backend, f.journal);
  await owner.attenuate(f.session, 0.5, new Set());
  f.session.volume = 0.65;
  assert.equal(await owner.attenuate(f.session, 0.25, new Set()), false);
  assert.equal(await owner.attenuate(f.session, 0.5, new Set()), false);
  await owner.restore();
  assert.equal(f.session.volume, 0.65);
  assert.deepEqual(f.saved, []);
  await owner.attenuate(f.session, 0.5, new Set());
  assert.equal(f.session.volume, 0.325, "the next speech cycle must use the user's new baseline");
  await owner.restore();
  assert.equal(f.session.volume, 0.65);
});

test("disk failure prevents mutation; a lost reply after mutation remains recoverable after restart", async () => {
  const failed = fixture(),
    first = await ChatMixVolumeLeases.open(failed.backend, failed.journal);
  failed.diskFailure();
  await assert.rejects(first.attenuate(failed.session, 0.5, new Set()), /disk failure/);
  assert.deepEqual(failed.writes, []);
  const f = fixture(),
    before = await ChatMixVolumeLeases.open(f.backend, f.journal);
  f.pipeFailure(true);
  await assert.rejects(before.attenuate(f.session, 0.5, new Set()), /pipe loss/);
  assert.equal(f.session.volume, 0.4);
  assert.equal(f.saved.length, 1);
  f.pipeFailure(false);
  const recovered = await ChatMixVolumeLeases.open(f.backend, f.journal);
  await recovered.restore();
  assert.equal(f.session.volume, 0.8);
  assert.deepEqual(f.saved, []);
});

test("unplugged sessions stay pending; exited instances are forgotten without modifying new instances", async () => {
  const f = fixture(),
    owner = await ChatMixVolumeLeases.open(f.backend, f.journal);
  await owner.attenuate(f.session, 0.5, new Set());
  f.hide();
  assert.equal((await owner.restore()).pending, 1);
  f.show();
  f.session.instanceId = "new-instance";
  assert.equal((await owner.restore()).pending, 1);
  assert.equal(f.writes.length, 1);
  f.exit();
  assert.equal((await owner.restore()).pending, 0);
  assert.equal(f.writes.length, 1);
});

test("invalid recovery data is rejected without overwriting it", async () => {
  let writes = 0;
  const f = fixture();
  await assert.rejects(
    ChatMixVolumeLeases.open(f.backend, {
      read: async () => [{ ...f.session, original: 1, previous: NaN, intended: 0.5 }],
      write: async () => {
        writes++;
      },
    }),
    /journal_invalid/,
  );
  assert.equal(writes, 0);
});
