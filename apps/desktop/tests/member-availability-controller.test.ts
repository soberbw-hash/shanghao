import assert from "node:assert/strict";
import test from "node:test";
import {
  MemberAvailabilityController,
  type AvailabilityChoice,
} from "../src/renderer/src/features/room/memberAvailabilityController";
import type { MemberAvailability } from "../src/renderer/src/features/room/memberAvailability";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
function fixture(muted = false, deafened = false) {
  let baseline = { isMuted: muted, isDeafened: deafened, isManuallyMuted: muted && !deafened };
  let status: MemberAvailability | undefined,
    owns = true,
    holds = 0,
    failures = 0;
  let wait: Promise<void> | undefined,
    failPhone = false;
  const phoneCalls: boolean[] = [],
    published: Array<MemberAvailability | undefined> = [];
  const audio = {
    ...baseline,
    phoneModeActive: false,
    setAudioState(next: typeof baseline) {
      if (!audio.phoneModeActive) Object.assign(audio, next);
    },
    setPhoneModeResumeState(next: typeof baseline) {
      if (audio.phoneModeActive) baseline = { ...next };
    },
  };
  const emit = (active: boolean) => {
    if (active === audio.phoneModeActive) return;
    if (active) {
      baseline = {
        isMuted: audio.isMuted,
        isDeafened: audio.isDeafened,
        isManuallyMuted: audio.isManuallyMuted,
      };
      Object.assign(audio, { phoneModeActive: true, isMuted: true, isDeafened: true });
    } else Object.assign(audio, baseline, { phoneModeActive: false });
  };
  const control = new MemberAvailabilityController({
    audio: () => audio,
    status: () => status,
    ownsRoom: () => owns,
    phone: async (active) => {
      phoneCalls.push(active);
      await wait;
      if (failPhone) throw Error("native unavailable");
      emit(active);
    },
    select: (next) => {
      status = next;
      published.push(next);
    },
    hold: () => {
      holds++;
      return () => {
        holds--;
      };
    },
    reconcile: () => assert.equal(holds, 0),
    failed: () => {
      failures++;
    },
  });
  return {
    control,
    audio,
    emit,
    phoneCalls,
    published,
    status: () => status,
    holds: () => holds,
    failures: () => failures,
    gate: (promise: Promise<void>) => {
      wait = promise;
    },
    fail: () => {
      failPhone = true;
    },
    leave: () => {
      owns = false;
    },
  };
}

test("all twelve cross-status transitions work directly, then clicking the current choice restores the baseline", async () => {
  const choices: AvailabilityChoice[] = ["away", "phone", "eating", "restroom"];
  for (const first of choices)
    for (const second of choices) {
      if (first === second) continue;
      const f = fixture();
      f.control.choose(first);
      await flush();
      f.control.choose(second);
      await flush();
      assert.equal(f.audio.phoneModeActive, second === "phone", `${first} -> ${second}`);
      assert.equal(f.status(), second === "phone" ? undefined : second);
      assert.equal(f.audio.isMuted, true);
      assert.equal(f.audio.isDeafened, second === "away" || second === "phone");
      f.control.choose(second);
      await flush();
      assert.equal(f.audio.phoneModeActive, false);
      assert.equal(f.status(), undefined);
      assert.equal(f.audio.isMuted, false);
      assert.equal(f.audio.isDeafened, false);
      assert.equal(f.failures(), 0);
      f.control.dispose();
    }
});

test("switching across all choices preserves manual mute and deafen instead of reopening them", async () => {
  for (const muted of [false, true])
    for (const deafened of [false, true]) {
      const f = fixture(muted, deafened);
      for (const choice of ["eating", "phone", "away", "restroom", "restroom"] as const) {
        f.control.choose(choice);
        await flush();
      }
      assert.equal(f.audio.isMuted, muted);
      assert.equal(f.audio.isDeafened, deafened);
      assert.equal(f.audio.isManuallyMuted, muted && !deafened);
    }
});

test("clicks during native phone entry coalesce to the last choice without briefly reopening audio", async () => {
  const f = fixture();
  let release!: () => void;
  f.gate(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  f.control.choose("phone");
  f.control.choose("eating");
  f.control.choose("away");
  f.control.choose("restroom");
  assert.equal(f.holds(), 1);
  assert.deepEqual(f.published, []);
  release();
  await flush();
  assert.deepEqual(f.phoneCalls, [true, false]);
  assert.deepEqual(f.published, ["restroom"]);
  assert.equal(f.audio.isMuted, true);
  assert.equal(f.audio.isDeafened, false);
});

test("a second phone click during entry cancels it without needing a separate return button", async () => {
  const f = fixture();
  let release!: () => void;
  f.gate(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  f.control.choose("phone");
  f.control.choose("phone");
  release();
  await flush();
  assert.deepEqual(f.phoneCalls, [true, false]);
  assert.equal(f.audio.phoneModeActive, false);
  assert.equal(f.audio.isMuted, false);
});

test("failed native phone restoration cannot claim a new status or unmute", async () => {
  const f = fixture();
  f.control.choose("phone");
  await flush();
  f.fail();
  f.control.choose("eating");
  await flush();
  assert.equal(f.audio.phoneModeActive, true);
  assert.equal(f.audio.isMuted, true);
  assert.deepEqual(f.published, [undefined]);
  assert.equal(f.failures(), 1);
});

test("keyboard cancellation of a mouse phone selection restores the baseline, then honors a new manual mute", async () => {
  const f = fixture();
  f.control.choose("eating");
  await flush();
  f.control.choose("phone");
  await flush();
  f.emit(false);
  assert.equal(f.status(), undefined);
  assert.equal(f.audio.isMuted, false);
  f.audio.isMuted = true;
  f.audio.isManuallyMuted = true;
  f.control.choose("restroom");
  f.control.choose("restroom");
  await flush();
  assert.equal(f.audio.isMuted, true);
  assert.equal(f.audio.isManuallyMuted, true);
});

test("leaving releases the send hold immediately and late native completion cannot edit the new room", async () => {
  const f = fixture();
  let release!: () => void;
  f.gate(
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  f.control.choose("phone");
  f.leave();
  f.control.dispose();
  assert.equal(f.holds(), 0);
  release();
  await flush();
  assert.equal(f.holds(), 0);
  assert.deepEqual(f.published, []);
});
