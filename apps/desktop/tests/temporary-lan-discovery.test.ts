import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createSocket } from "node:dgram";
import test from "node:test";
import {
  TemporaryLanDiscovery,
  lanAnnouncementSigningPayload,
  verifyLanRoomAnnouncement,
  lanBroadcastTargets,
} from "../src/main/temporary-lan-discovery";

const announcement = (now: number, session = "a", epoch = 1) => {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const authorityId = `device_${createHash("sha256")
    .update(keys.publicKey.export({ type: "spki", format: "der" }))
    .digest("base64url")}`;
  const payload = {
    protocol: 1 as const,
    type: "announcement" as const,
    authorityId,
    publicKey,
    sessionId: `temp_${session.repeat(32)}`,
    epoch,
    port: 43825,
    certificateSha256: "c".repeat(64),
    discoveryId: "d".repeat(43),
    issuedAt: now,
    expiresAt: now + 10000,
  };
  return {
    payload,
    signature: sign(
      null,
      Buffer.from(lanAnnouncementSigningPayload(payload)),
      keys.privateKey,
    ).toString("base64url"),
  };
};

test("signed LAN announcement binds device, session, epoch and exact TLS pin, never room credentials", () => {
  const signed = announcement(1000);
  assert.deepEqual(verifyLanRoomAnnouncement(signed, 1001), signed);
  for (const payload of [
    { ...signed.payload, certificateSha256: "e".repeat(64) },
    { ...signed.payload, epoch: 2 },
    { ...signed.payload, authorityId: "device_" + "x".repeat(43) },
    { ...signed.payload, expiresAt: 999999 },
  ])
    assert.equal(verifyLanRoomAnnouncement({ ...signed, payload }, 1001), undefined);
  assert.equal(verifyLanRoomAnnouncement(signed, 11000), undefined);
  const stripped = verifyLanRoomAnnouncement(
    { ...signed, payload: { ...signed.payload, code: "01234567", ticket: "secret" } },
    1001,
  );
  assert.ok(stripped);
  assert.equal(JSON.stringify(stripped).includes("01234567"), false);
  assert.equal(JSON.stringify(stripped).includes("secret"), false);
});

test("multihomed broadcast targets derive from each interface netmask and skip loopback", () => {
  const targets = lanBroadcastTargets(
    {
      Ethernet: [
        { address: "192.168.1.12", netmask: "255.255.255.0", family: "IPv4", internal: false },
      ],
      WiFi: [{ address: "10.2.3.4", netmask: "255.255.0.0", family: "IPv4", internal: false }],
      Loopback: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", internal: true }],
    } as never,
    43824,
  );
  assert.deepEqual(targets.map(({ address }) => address).sort(), ["10.2.255.255", "192.168.1.255"]);
});

test("isolated UDP discovery verifies signed advertisements and returns pinned endpoints without sending a code", async () => {
  const captured: string[] = [];
  const host = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    targets: [],
  });
  const address = await host.start();
  host.publish(announcement(Date.now()));
  const client = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    targets: [{ address: "127.0.0.1", port: address.port }],
    onPacket: (data) => captured.push(data),
  });
  await client.start();
  try {
    const found = await client.discover({ durationMs: 60 });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.certificateSha256, "c".repeat(64));
    assert.equal(found[0]?.endpoint, "wss://127.0.0.1:43825");
    assert.equal(
      captured.some((packet) => /code|ticket|credential/.test(packet)),
      false,
    );
  } finally {
    await client.stop();
    await host.stop();
  }
  await assert.rejects(client.discover(), /discovery_closed/);
});

test("lookup rejects same-code different-session ambiguity and cancellation releases pending work", async () => {
  const host = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    targets: [],
  });
  const address = await host.start();
  host.publish(announcement(Date.now(), "a"));
  host.publish(announcement(Date.now(), "b"));
  const client = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    targets: [{ address: "127.0.0.1", port: address.port }],
  });
  await client.start();
  try {
    await assert.rejects(
      client.lookup(
        "0123 4567",
        async (endpoint, code) => {
          assert.equal(code, "01234567");
          return {
            sessionId: endpoint.sessionId,
            authorityId: endpoint.authorityId,
            epoch: endpoint.epoch,
          };
        },
        { durationMs: 60 },
      ),
      /code_ambiguous/,
    );
    const abort = new AbortController();
    const pending = client.discover({ durationMs: 1000, signal: abort.signal });
    abort.abort();
    let timer: NodeJS.Timeout | undefined;
    try {
      await assert.rejects(
        Promise.race([
          pending,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("resolver_did_not_cancel")), 200);
          }),
        ]),
        /discovery_cancelled/,
      );
    } finally {
      clearTimeout(timer);
    }
    assert.equal(client.getStats().pendingQueries, 0);
  } finally {
    await client.stop();
    await host.stop();
  }
});

test("UDP receiver drops oversized and malformed packets and bounds probe amplification", async () => {
  const packets: string[] = [];
  const host = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    targets: [],
    responsesPerSecond: 2,
    onPacket: (data) => packets.push(data),
  });
  const address = await host.start();
  host.publish(announcement(Date.now()));
  const sender = createSocket("udp4");
  try {
    for (const data of [
      "x".repeat(4096),
      "{broken",
      ...Array.from({ length: 8 }, () =>
        JSON.stringify({ protocol: 1, type: "probe", nonce: "n".repeat(43) }),
      ),
    ])
      await new Promise<void>((resolve, reject) =>
        sender.send(data, address.port, "127.0.0.1", (error) =>
          error ? reject(error) : resolve(),
        ),
      );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.ok(host.getStats().droppedPackets >= 2);
    assert.equal(packets.length, 2);
  } finally {
    sender.close();
    await host.stop();
  }
});

test("lookup cancellation interrupts an unresponsive authenticated resolver and stop removes its owner", async () => {
  const host = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    targets: [],
  });
  const address = await host.start();
  host.publish(announcement(Date.now()));
  const client = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    targets: [{ address: "127.0.0.1", port: address.port }],
  });
  await client.start();
  try {
    const abort = new AbortController();
    const pending = client.lookup(
      "01234567",
      async (_endpoint, _code, signal) => {
        assert.equal(signal?.aborted, false);
        abort.abort();
        return new Promise<never>(() => undefined);
      },
      { durationMs: 20, signal: abort.signal },
    );
    let timer: NodeJS.Timeout | undefined;
    try {
      await assert.rejects(
        Promise.race([
          pending,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("resolver_did_not_cancel")), 200);
          }),
        ]),
        /discovery_cancelled/,
      );
    } finally {
      clearTimeout(timer);
    }
    assert.equal(client.getStats().pendingQueries, 0);
  } finally {
    await client.stop();
    await host.stop();
  }
});

test("cached endpoints expire at TTL and same-session competing authorities are not silently selected", async () => {
  let now = 1000;
  const host = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    targets: [],
    now: () => now,
  });
  const address = await host.start();
  host.publish(announcement(now));
  host.publish(announcement(now));
  const client = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    now: () => now,
    targets: [{ address: "127.0.0.1", port: address.port }],
  });
  await client.start();
  try {
    await assert.rejects(
      client.lookup(
        "01234567",
        async (endpoint) => ({
          sessionId: endpoint.sessionId,
          authorityId: endpoint.authorityId,
          epoch: endpoint.epoch,
        }),
        { durationMs: 30 },
      ),
      /authority_ambiguous/,
    );
    assert.equal(client.snapshot().length, 2);
    now = 11000;
    assert.deepEqual(client.snapshot(), []);
  } finally {
    await client.stop();
    await host.stop();
  }
});

test("signed announcement floods are bounded before cryptographic work and stop releases the UDP port", async () => {
  const service = new TemporaryLanDiscovery({
    bindAddress: "127.0.0.1",
    port: 0,
    allowLoopback: true,
    targets: [],
  });
  const address = await service.start();
  const sender = createSocket("udp4");
  try {
    const packet = JSON.stringify(announcement(Date.now()));
    for (let index = 0; index < 40; index += 1)
      await new Promise<void>((resolve, reject) =>
        sender.send(packet, address.port, "127.0.0.1", (error) =>
          error ? reject(error) : resolve(),
        ),
      );
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.ok(service.getStats().droppedPackets >= 8);
  } finally {
    sender.close();
    await service.stop();
  }
  const replacement = createSocket("udp4");
  try {
    await new Promise<void>((resolve, reject) => {
      replacement.once("error", reject);
      replacement.bind(address.port, "127.0.0.1", () => resolve());
    });
  } finally {
    replacement.close();
  }
});
