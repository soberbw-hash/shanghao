import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { SignalingServer } from "../../../packages/signaling/src/server";
import {
  temporaryAuthSigningPayload,
  type TemporaryAuthChallenge,
} from "../../../packages/shared/src/types/temporary-room.types";
import { TemporaryRoomClient } from "../src/main/temporary-room-client";
import type { TemporaryIdentityStore } from "../src/main/temporary-identity-store";

function identity(nickname: string): TemporaryIdentityStore {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    getProfile: async () => ({
      nickname,
      avatarId: "fox",
      avatarDataUrl:
        nickname === "甲"
          ? "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lR8AAAAASUVORK5CYII="
          : undefined,
      publicKey,
    }),
    signChallenge: async (challenge: TemporaryAuthChallenge) => ({
      challengeId: challenge.challengeId,
      publicKey,
      signature: sign(
        null,
        Buffer.from(temporaryAuthSigningPayload(challenge)),
        pair.privateKey,
      ).toString("base64url"),
    }),
  } as TemporaryIdentityStore;
}

test("Main-owned temporary client reconnects with a fresh proof and rotated ticket; descriptors never expose tickets", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "shanghao-temp-client-"));
  const server = new SignalingServer({
    roomName: "fixture",
    privateRoomFile: path.join(root, "rooms.json"),
    dailyRoomReportFile: path.join(root, "daily.json"),
    accountBackend: { configured: false } as never,
  });
  const port = await server.listen();
  const opened: WebSocket[] = [];
  const make = (name: string) =>
    new TemporaryRoomClient(
      identity(name),
      () => `ws://127.0.0.1:${port}/temporary`,
      (url) => {
        const socket = new WebSocket(url, { headers: { "x-forwarded-proto": "https" } });
        opened.push(socket);
        return socket;
      },
    );
  const a = make("甲"),
    b = make("乙");
  let latest:
    | import("../../../packages/shared/src/types/temporary-room.types").TemporaryRoomSnapshot
    | undefined;
  b.onState((state) => {
    if (state.room) latest = state.room;
  });
  t.after(async () => {
    a.close();
    b.close();
    opened.forEach((s) => s.terminate());
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  const first = await a.create();
  assert.equal(first.avatarDataUrl, first.room.members[0]?.profile.avatarDataUrl);
  assert.match(first.avatarDataUrl!, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(first).includes('"ticket"'), false);
  assert.match(first.signalingUrl, /#temporary=/);
  assert.equal(await a.acquire(first.signalingUrl), opened[0]);
  await assert.rejects(a.create(), /temporary_already_joined/);
  const second = await b.join(first.room.code);
  assert.equal(second.room.members.length, 2);
  const old = opened[0];
  const closed = once(old, "close");
  old.terminate();
  await closed;
  const recovered = await a.acquire(first.signalingUrl);
  assert.notEqual(recovered, old);
  // Authority transfers to the remaining connected member, including during grace.
  await assert.rejects(
    a.manage({ contextId: first.contextId, expected: latest!, action: "rotate" }),
    /temporary_admin_required/,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const locked = await b.manage({
    contextId: second.contextId,
    expected: latest!,
    action: "lock",
    locked: true,
  });
  assert.equal(locked.locked, true);
  a.release(first.contextId);
  await assert.rejects(a.acquire(first.signalingUrl), /temporary_context_invalid/);
});

test("the temporary client rejects insecure nonlocal endpoints before opening a socket", async () => {
  let opened = false;
  const client = new TemporaryRoomClient(
    identity("甲"),
    () => "ws://example.com/temporary",
    () => {
      opened = true;
      throw Error("unexpected");
    },
  );
  await assert.rejects(client.create(), /temporary_secure_connection_required/);
  assert.equal(opened, false);
});

test("closing Main while route discovery is pending cannot create a late socket or room", async () => {
  let resolveRoute!: (route: { url: string }) => void;
  let opened = false;
  const client = new TemporaryRoomClient(
    identity("甲"),
    () => "wss://example.invalid",
    () => {
      opened = true;
      throw Error("unexpected");
    },
    {
      resolve: () =>
        new Promise((resolve) => {
          resolveRoute = resolve;
        }),
    },
  );
  const creating = client.create();
  client.close();
  resolveRoute({ url: "wss://example.invalid/temporary" });
  await assert.rejects(creating, /temporary_client_closed/);
  assert.equal(opened, false);
});

test("Main retains the first LAN-only warning across ordinary updates and clears it only on matching connectivity recovery", async (t) => {
  const server = new SignalingServer({
      roomName: "warning fixture",
      accountBackend: { configured: false } as never,
    }),
    port = await server.listen();
  const url = `ws://127.0.0.1:${port}/temporary`;
  let network!: (id: string, error?: string) => void,
    subscribed = true;
  const client = new TemporaryRoomClient(
    identity("甲"),
    () => url,
    (value) => new WebSocket(value, { headers: { "x-forwarded-proto": "https" } }),
    {
      resolve: async () => ({ url }),
      joined: async () => "temporary_internet_bridge_unavailable",
      onConnectivity: (listener) => {
        network = listener;
        return () => {
          subscribed = false;
        };
      },
    },
  );
  t.after(async () => {
    client.close();
    await server.close();
  });
  const first = await client.create();
  assert.equal(first.connectionWarning, "temporary_internet_bridge_unavailable");
  const states: import("../../../packages/shared/src/types/temporary-room-client.types").TemporaryRoomClientState[] =
    [];
  client.onState((s) => states.push(s));
  network("temp_" + "f".repeat(32));
  assert.equal(states.length, 0);
  const updated = await client.manage({
    contextId: first.contextId,
    action: "lock",
    locked: true,
    expected: first.room,
  });
  assert.equal(states.at(-1)?.error, "temporary_internet_bridge_unavailable");
  network(first.roomId);
  assert.equal(states.at(-1)?.error, undefined);
  await client.manage({
    contextId: first.contextId,
    action: "lock",
    locked: false,
    expected: updated,
  });
  assert.equal(states.at(-1)?.error, undefined);
  network(first.roomId, "temporary_internet_bridge_unavailable");
  assert.equal(states.at(-1)?.error, "temporary_internet_bridge_unavailable");
  client.close();
  assert.equal(subscribed, false);
});
