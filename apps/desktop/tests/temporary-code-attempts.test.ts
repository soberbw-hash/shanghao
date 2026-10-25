import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { EventEmitter, once } from "node:events";
import test from "node:test";
import type { WebSocket } from "ws";
import {
  TemporaryCodeAttempts,
  temporaryCodeAttemptOptionsFromEnvironment,
} from "../../../packages/signaling/src/temporary-code-attempts";
import { TemporaryRoomRuntime } from "../../../packages/signaling/src/temporary-room-runtime";
import { TemporaryInternetBroker } from "../../../packages/signaling/src/temporary-internet-broker";
import { temporaryAuthSigningPayload } from "../../../packages/shared/src/types/temporary-room.types";
import type { TemporaryAuthChallenge } from "../../../packages/shared/src/types/temporary-room.types";
import {
  internetRegistrationSigningPayload,
  type TemporaryInternetRegistration,
} from "../../../packages/signaling/src/temporary-internet-protocol";

test("server-only configuration is numeric, bounded and independent of request data", () => {
  const options = temporaryCodeAttemptOptionsFromEnvironment({
    SHANGHAO_TEMP_CODE_DEVICE_FAILURES: "3",
    SHANGHAO_TEMP_CODE_BASE_DELAY_MS: "5000",
  });
  assert.deepEqual(options, { deviceFailures: 3, baseDelayMs: 5000 });
  assert.throws(
    () =>
      temporaryCodeAttemptOptionsFromEnvironment({ SHANGHAO_TEMP_CODE_BASE_DELAY_MS: "Infinity" }),
    /configuration_invalid/,
  );
  assert.throws(
    () =>
      new TemporaryCodeAttempts(
        Date.now,
        temporaryCodeAttemptOptionsFromEnvironment({ SHANGHAO_TEMP_CODE_MAX_ENTRIES: "999999999" }),
      ),
    /configuration_invalid/,
  );
});
const identity = () => {
  const key = generateKeyPairSync("ed25519");
  const publicKey = key.publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    publicKey,
    deviceId: `device_${createHash("sha256")
      .update(key.publicKey.export({ type: "spki", format: "der" }))
      .digest("base64url")}`,
    signPayload: (payload: string) =>
      sign(null, Buffer.from(payload), key.privateKey).toString("base64url"),
    proof: (challenge: TemporaryAuthChallenge) => ({
      publicKey,
      challengeId: challenge.challengeId,
      signature: sign(
        null,
        Buffer.from(temporaryAuthSigningPayload(challenge)),
        key.privateKey,
      ).toString("base64url"),
    }),
  };
};
class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  responses: Record<string, unknown>[] = [];
  send(raw: string) {
    const value = JSON.parse(raw);
    this.responses.push(value);
    this.emit("response", value);
  }
  close() {
    this.readyState = 3;
    this.emit("close");
  }
  asWebSocket() {
    return this as unknown as WebSocket;
  }
}

test("device failures survive minute boundaries and network changes, with exponential bounded cooldown", () => {
  let now = 1000;
  const guard = new TemporaryCodeAttempts(() => now);
  for (let i = 0; i < 5; i++)
    assert.equal(
      guard.attempt(
        "device-a",
        "net-a",
        () => null,
        (v) => v !== null,
      ),
      null,
    );
  assert.throws(() => guard.attempt("device-a", "net-b", () => true), /temporary_rate_limited/);
  for (let failures = 6; failures <= 12; failures++) {
    now += Math.min(300_000, 2000 * 2 ** (failures - 6));
    guard.attempt(
      "device-a",
      "net-b",
      () => null,
      (v) => v !== null,
    );
  }
  now += 60_001;
  let invoked = false;
  assert.throws(
    () =>
      guard.attempt("device-a", "net-c", () => {
        invoked = true;
        return true;
      }),
    /temporary_rate_limited/,
  );
  assert.equal(invoked, false, "a blocked attempt must not run an admission mutation");
  now += 300_000;
  assert.equal(
    guard.attempt("device-a", "net-c", () => true),
    true,
  );
});

test("network failures span devices; valid codes cannot erase a shared network's failures", () => {
  let now = 1000;
  const guard = new TemporaryCodeAttempts(() => now, { deviceFailures: 2, networkFailures: 3 });
  guard.attempt(
    "a",
    "shared",
    () => null,
    (v) => v !== null,
  );
  guard.attempt("a", "shared", () => true);
  guard.attempt(
    "b",
    "shared",
    () => null,
    (v) => v !== null,
  );
  guard.attempt(
    "c",
    "shared",
    () => null,
    (v) => v !== null,
  );
  assert.throws(() => guard.attempt("new-device", "shared", () => true), /temporary_rate_limited/);
  assert.equal(
    guard.attempt("unrelated", "unrelated", () => true),
    true,
  );
  now += 2000;
  assert.equal(
    guard.attempt("new-device", "shared", () => true),
    true,
  );
  guard.attempt(
    "another",
    "shared",
    () => null,
    (v) => v !== null,
  );
  now += 2000;
  assert.throws(() => guard.attempt("newer", "shared", () => true), /temporary_rate_limited/);
});

test("failure state is bounded, expires without active retries extending cooldown, and rejects invalid options", () => {
  let now = 1000;
  const guard = new TemporaryCodeAttempts(() => now, {
    maxEntries: 2,
    deviceFailures: 1,
    networkFailures: 1,
  });
  guard.attempt(
    "a",
    "net",
    () => null,
    (v) => v !== null,
  );
  for (let i = 0; i < 20; i++)
    assert.throws(() => guard.attempt(`blocked-${i}`, "net", () => true), /temporary_rate_limited/);
  now += 2000;
  assert.equal(
    guard.attempt("a", "net", () => true),
    true,
    "blocked retries did not extend the deadline",
  );
  guard.attempt(
    "b",
    "net",
    () => null,
    (v) => v !== null,
  );
  assert.throws(() => guard.attempt("c", "other", () => true), /temporary_rate_limited/);
  now += 30 * 60_000;
  assert.equal(
    guard.attempt("c", "other", () => true),
    true,
  );
  assert.throws(
    () => new TemporaryCodeAttempts(() => now, { maxEntries: NaN }),
    /configuration_invalid/,
  );
  assert.throws(
    () => new TemporaryCodeAttempts(() => now, { deviceFailures: 0 }),
    /configuration_invalid/,
  );
});

test("unavailable rooms and non-code errors do not count as wrong guesses, and clock rollback cannot bypass cooldown", () => {
  let now = 1000;
  const guard = new TemporaryCodeAttempts(() => now, { deviceFailures: 2 });
  for (let i = 0; i < 10; i++)
    assert.throws(
      () =>
        guard.attempt("a", "net", () => {
          throw Error("temporary_room_full");
        }),
      /room_full/,
    );
  assert.equal(
    guard.attempt("a", "net", () => true),
    true,
  );
  for (let i = 0; i < 2; i++)
    assert.throws(
      () =>
        guard.attempt("a", "net", () => {
          throw Error("temporary_room_not_found");
        }),
      /not_found/,
    );
  now = 0;
  assert.throws(() => guard.attempt("a", "net", () => true), /temporary_rate_limited/);
});

test("a known but temporarily unavailable code is neutral, without erasing earlier wrong guesses", () => {
  const guard = new TemporaryCodeAttempts(() => 1000, { deviceFailures: 2 });
  guard.attempt(
    "a",
    "net",
    () => null,
    () => false,
  );
  for (let i = 0; i < 10; i++)
    guard.attempt(
      "a",
      "net",
      () => null,
      () => undefined,
    );
  guard.attempt(
    "a",
    "net",
    () => null,
    () => false,
  );
  assert.throws(() => guard.attempt("a", "net", () => true), /temporary_rate_limited/);
});

test("actual authenticated Runtime resolve and join share device backoff across source addresses", () => {
  let now = 1000,
    request = 0,
    address = "net-a";
  const runtime = new TemporaryRoomRuntime({
    evict() {},
    now: () => now,
    codeAttemptOptions: { deviceFailures: 2, baseDelayMs: 60_000 },
  });
  const socket = new Socket(),
    device = identity();
  runtime.markEndpoint(socket.asWebSocket());
  const rpc = (data: Record<string, unknown>) => {
    runtime.handle(
      socket.asWebSocket(),
      { type: "temporary_room_request", version: 1, requestId: `p${++request}`, ...data },
      address,
    );
    return socket.responses.at(-1)!;
  };
  const guess = (command = "resolve", code = "00000000") => {
    const challenge = rpc({ command: "challenge", publicKey: device.publicKey });
    assert.equal(challenge.ok, true);
    return rpc({
      command,
      code,
      profile: { nickname: "访客" },
      proof: device.proof(challenge.value as TemporaryAuthChallenge),
    });
  };
  assert.equal(guess().code, "temporary_room_not_found");
  assert.equal(guess("join").code, "temporary_room_not_found");
  address = "net-b";
  assert.equal(guess().code, "temporary_rate_limited");
  now += 60_001;
  assert.equal(guess("join").code, "temporary_room_not_found");
  now += 60_001;
  assert.equal(
    guess().code,
    "temporary_rate_limited",
    "a fixed minute boundary cannot reset the failure history",
  );
});

test("internet lookup and room admission use one authenticated failure guard", async () => {
  let now = 1000,
    request = 0;
  const guard = new TemporaryCodeAttempts(() => now, { deviceFailures: 2 });
  const broker = new TemporaryInternetBroker(
    () => false,
    () => now,
    undefined,
    guard,
  );
  const socket = new Socket(),
    device = identity();
  broker.attach(socket.asWebSocket(), "internet-a");
  const rpc = async (data: Record<string, unknown>) => {
    const pending = once(socket, "response");
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "temporary_bridge_request",
          version: 1,
          requestId: `b${++request}`,
          ...data,
        }),
      ),
      false,
    );
    return (await pending)[0] as Record<string, unknown>;
  };
  const guess = async () => {
    const challenge = await rpc({ command: "challenge", publicKey: device.publicKey });
    return rpc({
      command: "lookup",
      code: "00000000",
      proof: device.proof(challenge.value as TemporaryAuthChallenge),
    });
  };
  assert.equal((await guess()).value, null);
  const challenge = await rpc({ command: "challenge", publicKey: device.publicKey });
  // Derive the exact verified device id via the same authenticator used in production.
  const { TemporaryRoomAuthenticator } =
    await import("../../../packages/signaling/src/temporary-room-auth");
  const auth = new TemporaryRoomAuthenticator({ now: () => now });
  const fresh = auth.issueChallenge({ publicKey: device.publicKey });
  const principal = auth.verify(device.proof(fresh));
  guard.attempt(
    principal.deviceId,
    "lan-a",
    () => null,
    (v) => v !== null,
  );
  const blocked = await rpc({
    command: "lookup",
    code: "00000000",
    proof: device.proof(challenge.value as TemporaryAuthChallenge),
  });
  assert.equal(blocked.code, "temporary_rate_limited");
  now += 2000;
  assert.equal((await guess()).value, null);
  socket.close();
  await broker.flush();
});

test("a member can resume despite guess cooldown, and invalid device proofs cannot poison another device", async () => {
  let request = 0;
  const runtime = new TemporaryRoomRuntime({
    evict() {},
    codeAttemptOptions: { deviceFailures: 2 },
  });
  await runtime.flush();
  const device = identity(),
    original = new Socket(),
    restored = new Socket();
  runtime.markEndpoint(original.asWebSocket());
  runtime.markEndpoint(restored.asWebSocket());
  const rpc = (socket: Socket, data: Record<string, unknown>) => {
    runtime.handle(
      socket.asWebSocket(),
      { type: "temporary_room_request", version: 1, requestId: `m${++request}`, ...data },
      "shared",
    );
    return socket.responses.at(-1)!;
  };
  const proof = (socket: Socket, sessionId?: unknown) =>
    device.proof(
      rpc(socket, { command: "challenge", publicKey: device.publicKey, sessionId })
        .value as TemporaryAuthChallenge,
    );
  for (let i = 0; i < 4; i++) {
    const invalid = { ...proof(original), signature: Buffer.alloc(64).toString("base64url") };
    assert.equal(rpc(original, { command: "resolve", code: "00000000", proof: invalid }).ok, false);
  }
  assert.equal(
    rpc(original, { command: "resolve", code: "00000000", proof: proof(original) }).code,
    "temporary_room_not_found",
  );
  const created = rpc(original, {
    command: "create",
    profile: { nickname: "成员" },
    proof: proof(original),
  });
  assert.equal(created.ok, true, String(created.code));
  const admission = created.value as { room: { sessionId: string; code: string }; ticket: unknown };
  const missing = admission.room.code === "00000000" ? "00000001" : "00000000";
  assert.equal(
    rpc(original, { command: "resolve", code: missing, proof: proof(original) }).code,
    "temporary_room_not_found",
  );
  assert.equal(
    rpc(original, { command: "resolve", code: missing, proof: proof(original) }).code,
    "temporary_rate_limited",
  );
  const resumed = rpc(restored, {
    command: "resume",
    ticket: admission.ticket,
    proof: proof(restored, admission.room.sessionId),
  });
  assert.equal(
    resumed.ok,
    true,
    "established membership recovery does not guess a public room code",
  );
});

test("a registered room's offline provider does not punish authenticated recovery lookups", async () => {
  const now = 1000;
  const broker = new TemporaryInternetBroker(
    () => false,
    () => now,
    undefined,
    new TemporaryCodeAttempts(() => now, { deviceFailures: 2 }),
  );
  const owner = identity(),
    guest = identity(),
    provider = new Socket(),
    query = new Socket();
  broker.attach(provider.asWebSocket(), "owner-net");
  broker.attach(query.asWebSocket(), "guest-net");
  let request = 0;
  const rpc = async (socket: Socket, data: Record<string, unknown>) => {
    const pending = once(socket, "response");
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "temporary_bridge_request",
          version: 1,
          requestId: `offline${++request}`,
          ...data,
        }),
      ),
      false,
    );
    return (await pending)[0] as Record<string, unknown>;
  };
  const prove = async (socket: Socket, device: ReturnType<typeof identity>, sessionId?: string) => {
    const challenge = await rpc(socket, {
      command: "challenge",
      publicKey: device.publicKey,
      sessionId,
    });
    assert.equal(challenge.ok, true);
    return device.proof(challenge.value as TemporaryAuthChallenge);
  };
  const payload: TemporaryInternetRegistration = {
    version: 1,
    sessionId: `temp_${"a".repeat(32)}`,
    authorityId: owner.deviceId,
    publicKey: owner.publicKey,
    epoch: 1,
    revision: 1,
    code: "00000000",
    members: [{ deviceId: owner.deviceId, publicKey: owner.publicKey }],
    certificateSha256: "a".repeat(64),
    issuedAt: now,
    expiresAt: now + 15000,
  };
  const registered = await rpc(provider, {
    command: "register",
    role: "authority",
    proof: await prove(provider, owner, payload.sessionId),
    signed: { payload, signature: owner.signPayload(internetRegistrationSigningPayload(payload)) },
  });
  assert.equal(registered.ok, true, String(registered.code));
  provider.close();
  for (let i = 0; i < 8; i++) {
    const lookup = await rpc(query, {
      command: "lookup",
      code: payload.code,
      proof: await prove(query, guest),
    });
    assert.equal(lookup.ok, true, "same known room is still recovering");
    assert.equal(lookup.value, null);
  }
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await rpc(query, { command: "lookup", code: "11111111", proof: await prove(query, guest) }))
        .ok,
      true,
    );
  assert.equal(
    (await rpc(query, { command: "lookup", code: "11111111", proof: await prove(query, guest) }))
      .code,
    "temporary_rate_limited",
  );
  query.close();
  await broker.flush();
});
