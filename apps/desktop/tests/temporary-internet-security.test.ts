import assert from "node:assert/strict";
import { createHash, X509Certificate } from "node:crypto";
import { createServer } from "node:https";
import test, { type TestContext } from "node:test";
import { createServer as createTcpServer, type Socket } from "node:net";
import { SignalingServer } from "../../../packages/signaling/src/server";
import { TemporaryLanDiscovery } from "../src/main/temporary-lan-discovery";
import { TemporaryLanHost } from "../src/main/temporary-lan-host";
import { TemporaryRoomClient } from "../src/main/temporary-room-client";
import { createLanCertificate } from "../src/main/temporary-lan-certificate";
import { TemporaryInternetProvider } from "../src/main/temporary-internet-provider";
import {
  TemporaryInternetConnection,
  openInternetRoomSocket,
  pairInternetSocket,
} from "../src/main/temporary-internet-connection";
import { temporaryTestIdentity } from "./helpers/temporary-test-identity";
import type {
  SignedInternetRegistration,
  TemporaryInternetRegistration,
} from "../../../packages/signaling/src/temporary-internet-protocol";
import type { WebSocket } from "ws";
import { createTemporaryRoomRouter } from "../src/main/temporary-room-router";
async function setup(t: TestContext) {
  const cert = createLanCertificate(),
    https = createServer({ cert: cert.cert, key: cert.key });
  const broker = new SignalingServer({
    roomName: "isolated",
    httpServer: https,
    host: "127.0.0.1",
    accountBackend: { configured: false } as never,
  });
  const port = await broker.listen();
  t.after(() => broker.close());
  const endpoint = { url: `wss://127.0.0.1:${port}/temporary`, certificate: cert.cert };
  const identity = temporaryTestIdentity(),
    guest = temporaryTestIdentity("访客");
  const discovery = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    targets: [],
  });
  const host = new TemporaryLanHost({ identity, discovery, bindAddress: "127.0.0.1" }),
    route = await host.start();
  const client = new TemporaryRoomClient(identity, () => route.url, undefined, {
    resolve: async () => route,
    joined: (r, s) => host.replication.joined(r, s),
  });
  t.after(async () => {
    client.close();
    await host.close();
    await discovery.stop();
  });
  const first = await client.create(),
    profile = (await identity.getProfile())!;
  const issuedAt = Date.now();
  const payload: TemporaryInternetRegistration = {
    version: 1,
    sessionId: first.roomId,
    authorityId: profile.deviceId,
    publicKey: profile.publicKey,
    epoch: 1,
    revision: first.room.revision,
    code: first.room.code,
    members: [{ deviceId: profile.deviceId, publicKey: profile.publicKey }],
    certificateSha256: createHash("sha256")
      .update(new X509Certificate(route.certificate!).raw)
      .digest("hex"),
    issuedAt,
    expiresAt: issuedAt + 15000,
  };
  const signed = await identity.signInternetRegistration(payload),
    provider = new TemporaryInternetProvider(identity, endpoint, Number(new URL(route.url).port));
  t.after(() => provider.close());
  await provider.publish(signed, "authority");
  const directory = new TemporaryInternetConnection(guest, endpoint);
  t.after(() => directory.close());
  return {
    identity,
    guest,
    host,
    discovery,
    client,
    route,
    first,
    payload,
    signed,
    provider,
    directory,
    endpoint,
  };
}

test("actual LAN and public same-code results for different Sessions are rejected instead of silently choosing either", async (t) => {
  const s = await setup(t);
  await s.provider.unpublish(s.first.roomId);
  const rogue = temporaryTestIdentity("另一间房"),
    profile = (await rogue.getProfile())!;
  const provider = new TemporaryInternetProvider(
    rogue,
    s.endpoint,
    Number(new URL(s.route.url).port),
  );
  t.after(() => provider.close());
  await provider.publish(
    await rogue.signInternetRegistration({
      ...s.payload,
      sessionId: "temp_" + "c".repeat(32),
      authorityId: profile.deviceId,
      publicKey: profile.publicKey,
      members: [profile],
    }),
    "authority",
  );
  const discovery = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    targets: [{ address: "127.0.0.1", port: (await s.discovery.start()).port }],
  });
  const host = new TemporaryLanHost({ identity: s.guest, discovery, bindAddress: "127.0.0.1" });
  t.after(async () => {
    await host.close();
    await discovery.stop();
  });
  const router = createTemporaryRoomRouter({
    identity: s.guest,
    discovery,
    host,
    endpoint: () => s.endpoint.url,
    internetEndpoint: () => s.endpoint,
  });
  await assert.rejects(router.resolve(s.first.room.code), /temporary_lan_code_ambiguous/);
});

test("a delayed close from a replaced control socket cannot reject the new generation's request", async (t) => {
  const s = await setup(t),
    control = new TemporaryInternetConnection(s.guest, s.endpoint);
  t.after(() => control.close());
  await control.request("lookup", { code: s.first.room.code });
  const internal = control as unknown as {
    socket: WebSocket;
    connect: () => Promise<WebSocket>;
    rpc: (value: Record<string, unknown>) => Promise<unknown>;
  };
  const old = internal.socket,
    emit = old.emit;
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    old.emit = function (event: string | symbol, ...args: unknown[]) {
      if (event === "close") {
        release = () => emit.call(old, event, ...args);
        resolve();
        return true;
      }
      return emit.call(old, event, ...args);
    };
  });
  old.terminate();
  await delayed;
  await internal.connect();
  const request = internal.rpc({
    command: "challenge",
    publicKey: (await s.guest.getProfile())!.publicKey,
  });
  const completed = assert.doesNotReject(request);
  await Promise.resolve();
  release();
  await completed;
});
test("global code ownership cannot be overwritten and higher epochs require the old authority's majority certificate", async (t) => {
  const s = await setup(t),
    rogue = temporaryTestIdentity("其他主持"),
    profile = (await rogue.getProfile())!;
  const other = new TemporaryInternetProvider(rogue, s.endpoint, Number(new URL(s.route.url).port));
  t.after(() => other.close());
  const claimed = await rogue.signInternetRegistration({
    ...s.payload,
    sessionId: "temp_" + "d".repeat(32),
    authorityId: profile.deviceId,
    publicKey: profile.publicKey,
    members: [profile],
  });
  await assert.rejects(other.publish(claimed, "authority"), /temporary_bridge_code_conflict/);
  const takeover = await rogue.signInternetRegistration({
    ...claimed.payload,
    sessionId: s.first.roomId,
    epoch: 2,
  });
  await assert.rejects(other.publish(takeover, "authority"), /temporary_bridge_authority_invalid/);
  assert.deepEqual(await s.directory.request("lookup", { code: s.first.room.code }), s.signed);
});
test("forged and expired advertisements and unaffiliated member providers are refused", async (t) => {
  const s = await setup(t);
  await assert.rejects(
    s.provider.publish({ ...s.signed, signature: "a".repeat(86) }, "authority"),
    /temporary_bridge_registration_invalid/,
  );
  const expired = await s.identity.signInternetRegistration({
    ...s.payload,
    issuedAt: Date.now() - 15000,
    expiresAt: Date.now() - 1,
  });
  await assert.rejects(
    s.provider.publish(expired, "authority"),
    /temporary_bridge_registration_invalid/,
  );
  const rogue = temporaryTestIdentity("外人"),
    profile = (await rogue.getProfile())!,
    other = new TemporaryInternetProvider(rogue, s.endpoint, Number(new URL(s.route.url).port));
  t.after(() => other.close());
  const member = await rogue.signInternetRegistration({
    ...s.payload,
    authorityId: profile.deviceId,
    publicKey: profile.publicKey,
  });
  await assert.rejects(other.publish(member, "member"), /temporary_bridge_membership_required/);
});
test("pipe secrets are one-use, wrong secrets do not claim a valid pipe, and closing either endpoint releases its peer", async (t) => {
  const s = await setup(t);
  const offer = (await s.directory.request("open", {}, s.first.roomId)) as {
    pipeId: string;
    secret: string;
    expiresAt: number;
  };
  await assert.rejects(
    pairInternetSocket(s.endpoint, { ...offer, secret: "a".repeat(43) }, "consumer"),
    /temporary_bridge_pipe_invalid/,
  );
  const socket = await pairInternetSocket(s.endpoint, offer, "consumer");
  t.after(() => socket.terminate());
  await assert.rejects(
    pairInternetSocket(s.endpoint, offer, "consumer"),
    /temporary_bridge_pipe_invalid/,
  );
  assert.equal(socket.readyState, 1);
  s.provider.close();
  await new Promise<void>((resolve) => {
    if (socket.readyState === 3) resolve();
    else socket.once("close", () => resolve());
  });
  assert.equal(socket.readyState, 3);
});
test("an inner certificate pin mismatch fails before a room WebSocket or admission can open", async (t) => {
  const s = await setup(t);
  const signed = await s.identity.signInternetRegistration({
    ...s.payload,
    revision: s.payload.revision + 1,
    certificateSha256: "a".repeat(64),
  });
  await s.provider.publish(signed, "authority");
  await assert.rejects(
    openInternetRoomSocket(s.guest, {
      broker: s.endpoint,
      sessionId: s.first.roomId,
      deviceId: s.payload.authorityId,
      registration: signed,
    }),
    /temporary_lan_tls_pin_mismatch/,
  );
});
test("cancelling an inner TLS handshake closes its owned TCP pipe promptly", async (t) => {
  const s = await setup(t),
    connections = new Set<Socket>();
  let accepted!: () => void;
  const ready = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  const tcp = createTcpServer((socket) => {
    connections.add(socket);
    socket.resume();
    socket.once("close", () => connections.delete(socket));
    accepted();
  });
  await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    for (const socket of connections) socket.destroy();
    await new Promise<void>((resolve) => tcp.close(() => resolve()));
  });
  const signed = await s.identity.signInternetRegistration({
    ...s.payload,
    sessionId: "temp_" + "b".repeat(32),
    code: "00009999",
  });
  const provider = new TemporaryInternetProvider(
    s.identity,
    s.endpoint,
    (tcp.address() as import("node:net").AddressInfo).port,
  );
  t.after(() => provider.close());
  await provider.publish(signed, "authority");
  const abort = new AbortController(),
    opening = openInternetRoomSocket(
      s.guest,
      {
        broker: s.endpoint,
        sessionId: signed.payload.sessionId,
        deviceId: s.payload.authorityId,
        registration: signed,
      },
      abort.signal,
    );
  // Attach the rejection observer before aborting to prevent an unhandled rejection between cleanup awaits.
  const rejected = assert.rejects(opening, /temporary_bridge_(tls_failed|cancelled|unavailable)/);
  await ready;
  const closed = Promise.all(
    [...connections].map(
      (socket) => new Promise<void>((resolve) => socket.once("close", () => resolve())),
    ),
  );
  const started = Date.now();
  abort.abort();
  await rejected;
  await closed;
  assert.ok(
    Date.now() - started < 1000,
    "cancellation releases the pipe without waiting for its five-second TLS timeout",
  );
});
test("a last-member unregister is terminal for old registrations and its code disappears", async (t) => {
  const s = await setup(t);
  await s.provider.unpublish(s.first.roomId);
  assert.equal(await s.directory.request("lookup", { code: s.first.room.code }), null);
  const issuedAt = Date.now();
  await assert.rejects(
    s.provider.publish(
      await s.identity.signInternetRegistration({
        ...s.payload,
        issuedAt,
        expiresAt: issuedAt + 15000,
      }),
      "authority",
    ),
    /temporary_bridge_session_closed/,
  );
});
test("withdrawing a member endpoint cannot terminate the authority or invalidate its lookup code", async (t) => {
  const s = await setup(t),
    profile = (await s.guest.getProfile())!;
  const authority = await s.identity.signInternetRegistration({
    ...s.payload,
    revision: s.payload.revision + 1,
    members: [...s.payload.members, { deviceId: profile.deviceId, publicKey: profile.publicKey }],
  });
  await s.provider.publish(authority, "authority");
  const member = new TemporaryInternetProvider(
    s.guest,
    s.endpoint,
    Number(new URL(s.route.url).port),
  );
  t.after(() => member.close());
  await member.publish(
    await s.guest.signInternetRegistration({
      ...authority.payload,
      authorityId: profile.deviceId,
      publicKey: profile.publicKey,
    }),
    "member",
  );
  await member.withdraw(s.first.roomId);
  assert.deepEqual(await s.directory.request("lookup", { code: s.first.room.code }), authority);
  await assert.rejects(
    s.directory.request("open", { deviceId: profile.deviceId }, s.first.roomId),
    /temporary_bridge_unavailable/,
  );
});
test("global reservation collision rotates only the lookup code while retaining the LAN Session and member ticket", async (t) => {
  const s = await setup(t),
    identity = temporaryTestIdentity("本地主持"),
    discovery = new TemporaryLanDiscovery({
      bindAddress: "127.0.0.1",
      port: 0,
      allowLoopback: true,
      targets: [],
    });
  const host = new TemporaryLanHost({ identity, discovery, bindAddress: "127.0.0.1" }),
    route = await host.start();
  const local = new TemporaryRoomClient(identity, () => route.url, undefined, {
    resolve: async () => route,
    joined: (r, rp) => host.replication.joined(r, rp),
  });
  t.after(async () => {
    local.close();
    await host.close();
    await discovery.stop();
  });
  const before = await local.create();
  const issuedAt = Date.now();
  const occupied = await s.identity.signInternetRegistration({
    ...s.payload,
    sessionId: "temp_" + "c".repeat(32),
    code: before.room.code,
    issuedAt,
    expiresAt: issuedAt + 15000,
  });
  await s.provider.publish(occupied, "authority");
  let changed = before.room;
  local.onState((state) => {
    if (state.room) changed = state.room;
  });
  host.configureInternet(() => s.endpoint);
  await host.joined(route, before.room);
  assert.notEqual(changed.code, before.room.code);
  assert.equal(changed.sessionId, before.roomId);
  assert.equal((await local.acquire(before.signalingUrl))?.readyState, 1);
  const found = (await s.directory.request("lookup", {
    code: changed.code,
  })) as SignedInternetRegistration;
  assert.equal(found.payload.sessionId, before.roomId);
  const unchanged = (await s.directory.request("lookup", {
    code: before.room.code,
  })) as SignedInternetRegistration;
  assert.equal(unchanged.payload.sessionId, occupied.payload.sessionId);
});
