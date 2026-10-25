import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { TemporaryHostInternet } from "../src/main/temporary-host-internet";
import { TemporaryInternetProvider } from "../src/main/temporary-internet-provider";
import { TemporaryInternetDirectory } from "../../../packages/signaling/src/temporary-internet-directory";
import { temporaryTestIdentity } from "./helpers/temporary-test-identity";
import type { TemporaryRoomSnapshot } from "@private-voice/shared";

test("overlapping host publications cannot submit an older authority revision after a newer commit or enter outage backoff", async (t) => {
  const identity = temporaryTestIdentity();
  const profile = (await identity.getProfile())!;
  const directory = new TemporaryInternetDirectory(undefined, () => false);
  const publish = TemporaryInternetProvider.prototype.publish;
  // Replace only network I/O: registration signatures, revision checks and commits stay real.
  TemporaryInternetProvider.prototype.publish = async (signed) => {
    await directory.register(signed);
  };
  t.after(() => {
    TemporaryInternetProvider.prototype.publish = publish;
  });
  const sign = identity.signInternetRegistration;
  let entered!: () => void;
  const signing = new Promise<void>((resolve) => (entered = resolve));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  identity.signInternetRegistration = async (payload) => {
    if (payload.revision === 1) {
      entered();
      await gate;
    }
    return sign(payload);
  };
  const host = new TemporaryHostInternet(
    identity,
    () => ({ url: "wss://example.invalid/temporary" }),
    12345,
    "a".repeat(64),
  );
  t.after(() => host.close());
  const room: TemporaryRoomSnapshot = {
    kind: "temporary",
    sessionId: "temp_" + "a".repeat(32),
    code: "00123456",
    epoch: 1,
    revision: 1,
    authorityId: profile.deviceId,
    adminMemberId: "member-a",
    locked: false,
    capacity: 5,
    createdAt: Date.now(),
    state: "active",
    members: [
      {
        memberId: "member-a",
        deviceId: profile.deviceId,
        publicKey: profile.publicKey,
        profile,
        generation: 1,
        joinedAt: Date.now(),
        state: "connected",
      },
    ],
  };
  const first = host.publish(room);
  await signing;
  const second = host.publish({ ...room, revision: 2 });
  await setImmediate();
  release();
  const results = await Promise.allSettled([first, second]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "fulfilled"],
  );
  assert.equal(host.routeFor(room.sessionId)?.registration.payload.revision, 2);
  await host.publish({ ...room, revision: 3 });
  assert.equal(host.routeFor(room.sessionId)?.registration.payload.revision, 3);
  await host.publish({ ...room, revision: 2 });
  assert.equal(host.routeFor(room.sessionId)?.registration.payload.revision, 3);
  let clock = Date.now();
  t.mock.method(Date, "now", () => ++clock);
  await host.publish({ ...room, revision: 4 });
  const registration = host.routeFor(room.sessionId)!.registration.payload;
  assert.equal(registration.revision, 4);
  assert.equal(registration.expiresAt - registration.issuedAt, 15000);
});
