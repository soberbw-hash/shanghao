import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { TemporaryRoomDescriptor, TemporaryRoomSnapshot } from "@private-voice/shared";
import type { TemporaryRoomRoute } from "../src/main/temporary-lan-host";
import { createServer } from "node:https";
import { SignalingServer } from "../../../packages/signaling/src/server";
import { createLanCertificate } from "../src/main/temporary-lan-certificate";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TemporaryInternetConnection } from "../src/main/temporary-internet-connection";
import { temporaryTestIdentity } from "./helpers/temporary-test-identity";

interface Replies {
  diagnostics: string[];
  configure: boolean;
  create: TemporaryRoomDescriptor;
  join: TemporaryRoomDescriptor;
  rotate: TemporaryRoomSnapshot;
  lock: TemporaryRoomSnapshot;
  partition: boolean;
  disconnect: boolean;
  recover: { open: boolean; room: TemporaryRoomSnapshot; peerId: string; replicaTunnels: number };
  state: TemporaryRoomSnapshot;
}

test(
  "successive internet-only rooms admit all members without an intermittent TLS entry failure",
  { timeout: 45000 },
  async (t) => {
    const cert = createLanCertificate();
    const broker = new SignalingServer({
      roomName: "entry stability",
      httpServer: createServer({ cert: cert.cert, key: cert.key }),
      host: "127.0.0.1",
      accountBackend: { configured: false } as never,
    });
    const port = await broker.listen();
    t.after(() => broker.close());
    const endpoint = { url: `wss://127.0.0.1:${port}/temporary`, certificate: cert.cert };
    for (let round = 0; round < 8; round++) {
      const peers = await Promise.all(Array.from({ length: 3 }, () => participant(t)));
      try {
        await Promise.all(
          peers.map((p) => p.rpc("configure", { endpoint, forceReplicaTunnel: true })),
        );
        const first = await peers[0]!.rpc("create").catch((error) => {
          throw Error(`round ${round} create: ${String(error)}`);
        });
        for (const [index, peer] of peers.slice(1).entries()) {
          const joined = await peer.rpc("join", { code: first.room.code }).catch(async (error) => {
            throw Error(
              `round ${round} join ${index}: ${String(error)}; owner: ${JSON.stringify(await peers[0]!.rpc("diagnostics"))}`,
            );
          });
          assert.equal(joined.roomId, first.roomId);
        }
      } finally {
        await Promise.all(peers.map((p) => stop(p.process)));
      }
    }
  },
);

test(
  "a restarted persistent internet directory reconnects the original Session through a majority-authorized new epoch",
  { timeout: 45000 },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "shanghao-broker-restart-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const cert = createLanCertificate();
    let port = 0;
    const start = async () => {
      const https = createServer({ cert: cert.cert, key: cert.key });
      const server = new SignalingServer({
        roomName: "restart broker",
        httpServer: https,
        host: "127.0.0.1",
        port,
        privateRoomFile: path.join(root, "rooms.json"),
        accountBackend: { configured: false } as never,
      });
      port = await server.listen();
      return server;
    };
    let broker = await start();
    t.after(() => broker.close().catch(() => undefined));
    const endpoint = { url: `wss://127.0.0.1:${port}/temporary`, certificate: cert.cert };
    const a = await participant(t),
      b = await participant(t),
      c = await participant(t);
    await Promise.all([a, b, c].map((p) => p.rpc("configure", { endpoint })));
    const first = await a.rpc("create");
    await b.rpc("join", { code: first.room.code });
    await c.rpc("join", { code: first.room.code });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await broker.close();
    // Keep the broker offline through lease expiry; an immediate restart can
    // legitimately restore the original authority before its lease expires.
    await new Promise((resolve) => setTimeout(resolve, 6000));
    broker = await start();
    const recovered = await b.rpc("recover");
    assert.equal(recovered.room.sessionId, first.roomId);
    assert.equal(recovered.room.epoch, 2);
    await c.rpc("recover");
    const query = new TemporaryInternetConnection(temporaryTestIdentity("查找"), endpoint);
    t.after(() => query.close());
    // The host deliberately backs off failed publication for 10 seconds, then
    // refreshes on its 5-second heartbeat. Local recovery can finish first.
    let publicRoom: unknown;
    const publicationDeadline = Date.now() + 18000;
    do {
      publicRoom = await query.request("lookup", { code: first.room.code });
      if (!publicRoom) await new Promise((resolve) => setTimeout(resolve, 500));
    } while (!publicRoom && Date.now() < publicationDeadline);
    assert.ok(
      publicRoom,
      "the authority must refresh its public endpoint after the directory restart",
    );
    const d = await participant(t);
    await d.rpc("configure", { endpoint });
    const joined = await d.rpc("join", { code: first.room.code });
    assert.equal(joined.roomId, first.roomId);
    assert.equal(joined.room.epoch, 2);
    assert.equal(joined.room.authorityId, recovered.room.authorityId);
  },
);

test(
  "internet directory and reverse TLS pipes preserve one Session across an actual authority process crash",
  { timeout: 45000 },
  async (t) => {
    const cert = createLanCertificate(),
      https = createServer({ cert: cert.cert, key: cert.key });
    const broker = new SignalingServer({
      roomName: "isolated broker",
      httpServer: https,
      host: "127.0.0.1",
      accountBackend: { configured: false } as never,
    });
    const port = await broker.listen();
    t.after(() => broker.close());
    const endpoint = { url: `wss://127.0.0.1:${port}/temporary`, certificate: cert.cert };
    const a = await participant(t),
      b = await participant(t),
      c = await participant(t);
    await Promise.all(
      [a, b, c].map((p) => p.rpc("configure", { endpoint, forceReplicaTunnel: true })),
    );
    const first = await a.rpc("create");
    const second = await b.rpc("join", { code: first.room.code }).catch(async (error) => {
      throw Error("second join:" + String(error) + JSON.stringify(await a.rpc("diagnostics")));
    });
    const third = await c.rpc("join", { code: first.room.code }).catch(async (error) => {
      throw Error("third join:" + String(error) + JSON.stringify(await a.rpc("diagnostics")));
    });
    assert.equal(second.roomId, first.roomId);
    assert.equal(third.roomId, first.roomId);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await stop(a.process);
    const resumed = await b.rpc("recover").catch(async (error) => {
      throw Error(String(error) + JSON.stringify(await c.rpc("diagnostics")) + c.stderr());
    });
    assert.equal(resumed.open, true);
    assert.equal(resumed.room.sessionId, first.roomId);
    assert.equal(resumed.room.epoch, 2);
    assert.equal(resumed.peerId, second.peerId);
    assert.ok(
      resumed.replicaTunnels > 0,
      "quorum/election private RPCs actually traversed inner TLS pipes instead of a loopback shortcut",
    );
    assert.equal(
      (
        await c.rpc("recover").catch(async (error) => {
          throw Error(
            "second recovery:" +
              String(error) +
              JSON.stringify(await b.rpc("diagnostics")) +
              JSON.stringify(await c.rpc("diagnostics")),
          );
        })
      ).room.epoch,
      2,
    );
    const d = await participant(t);
    await d.rpc("configure", { endpoint });
    const later = await d.rpc("join", { code: first.room.code }).catch(async (error) => {
      throw Error(
        "later join:" +
          String(error) +
          JSON.stringify(await b.rpc("diagnostics")) +
          JSON.stringify(await c.rpc("diagnostics")),
      );
    });
    assert.equal(later.roomId, first.roomId);
    assert.equal(later.room.epoch, 2);
  },
);

test(
  "two actual authority crashes during a broker outage preserve a five-member Session and replay every missing epoch on reconnect",
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), "shanghao-offline-handoffs-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const cert = createLanCertificate();
    let port = 0;
    const start = async () => {
      const https = createServer({ cert: cert.cert, key: cert.key });
      const server = new SignalingServer({
        roomName: "offline transitions",
        httpServer: https,
        host: "127.0.0.1",
        port,
        privateRoomFile: path.join(root, "rooms.json"),
        accountBackend: { configured: false } as never,
      });
      port = await server.listen();
      return server;
    };
    let broker = await start();
    let brokerRunning = true;
    t.after(() => (brokerRunning ? broker.close() : undefined));
    const endpoint = { url: `wss://127.0.0.1:${port}/temporary`, certificate: cert.cert };
    const members = await Promise.all(Array.from({ length: 5 }, () => participant(t)));
    await Promise.all(members.map((p) => p.rpc("configure", { endpoint })));
    const first = await members[0]!.rpc("create");
    for (const p of members.slice(1)) await p.rpc("join", { code: first.room.code });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    brokerRunning = false;
    await broker.close();
    await stop(members[0]!.process);
    const remaining = members.slice(1),
      recovered = await remaining[0]!.rpc("recover").catch(async (error) => {
        throw Error(
          "first offline recovery:" +
            String(error) +
            JSON.stringify(await Promise.all(remaining.map((p) => p.rpc("diagnostics")))),
        );
      });
    assert.equal(recovered.room.epoch, 2);
    for (const p of remaining)
      await p.rpc("recover").catch(async (error) => {
        throw Error(
          "remaining offline recovery:" +
            String(error) +
            JSON.stringify(await Promise.all(remaining.map((m) => m.rpc("diagnostics")))),
        );
      });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const leader = remaining.find((p) => p.ready.deviceId === recovered.room.authorityId)!;
    await stop(leader.process);
    const survivors = remaining.filter((p) => p !== leader),
      again = await survivors[0]!.rpc("recover");
    assert.equal(again.room.epoch, 3);
    assert.equal(again.room.sessionId, first.roomId);
    for (const p of survivors) await p.rpc("recover");
    broker = await start();
    brokerRunning = true;
    const query = new TemporaryInternetConnection(temporaryTestIdentity("断网恢复查找"), endpoint);
    t.after(() => query.close());
    let found: unknown;
    for (let attempt = 0; attempt < 15 && !found; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      found = await query.request("lookup", { code: first.room.code });
    }
    assert.ok(
      found,
      "the directory must verify both missing transitions instead of creating a replacement Session",
    );
    assert.equal(
      (found as { payload: { sessionId: string; epoch: number } }).payload.sessionId,
      first.roomId,
    );
    assert.equal((found as { payload: { epoch: number } }).payload.epoch, 3);
  },
);
interface FixtureMessage {
  ready?: boolean;
  route: TemporaryRoomRoute;
  deviceId: string;
  id: number;
  result: unknown;
  error?: string;
  errors?: string[];
}

async function participant(t: TestContext) {
  const process = fork(
    fileURLToPath(new URL("./fixtures/temporary-lan-process.ts", import.meta.url)),
    [],
    { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"] },
  );
  t.after(() => stop(process));
  let stderr = "";
  process.stderr!.on("data", (data) => (stderr += data.toString().slice(0, 2000)));
  let next = 0;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  const ready = await new Promise<Pick<FixtureMessage, "route" | "deviceId">>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error("fixture_start_timeout:" + stderr)), 20000);
    process.once("exit", () => {
      clearTimeout(timer);
      reject(Error("fixture_exit:" + stderr));
    });
    process.on("message", (m: FixtureMessage) => {
      if (m.ready) {
        clearTimeout(timer);
        resolve(m);
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.reject(Error(m.error + ":" + JSON.stringify(m.errors) + ":" + stderr));
      else p.resolve(m.result);
    });
  });
  return {
    process,
    ready,
    stderr: () => stderr,
    rpc<K extends keyof Replies>(command: K, args: Record<string, unknown> = {}) {
      return new Promise<Replies[K]>((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("fixture_rpc_timeout:" + command + ":" + stderr));
        }, 20000);
        pending.set(id, { resolve: (value) => resolve(value as Replies[K]), reject, timer });
        process.send({ id, command, ...args });
      });
    },
  };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await once(child, "exit");
}
test(
  "three isolated Main hosts replicate privately; actual authority process crash elects majority and recovers original members over pinned WSS",
  { timeout: 45000 },
  async (t) => {
    const a = await participant(t),
      b = await participant(t),
      c = await participant(t);
    t.after(async () => {
      await Promise.all([a, b, c].map((p) => stop(p.process)));
    });
    const first = await a.rpc("create");
    const second = await b.rpc("join", { route: a.ready.route, code: first.room.code });
    const third = await c.rpc("join", { route: a.ready.route, code: first.room.code });
    assert.equal(second.roomId, first.roomId);
    assert.equal(third.roomId, first.roomId);
    assert.equal(JSON.stringify(second).includes("tokenHash"), false);
    const rotated = await a.rpc("rotate");
    await a.rpc("lock");
    await new Promise((resolve) => setTimeout(resolve, 2500));
    await stop(a.process);
    const recovered = await b.rpc("recover").catch((error) => {
      throw Error(String(error) + c.stderr());
    });
    assert.equal(recovered.open, true);
    assert.equal(recovered.room.sessionId, first.roomId);
    assert.equal(recovered.peerId, second.peerId);
    assert.equal(recovered.room.epoch, 2);
    assert.equal(recovered.room.locked, true);
    assert.equal(recovered.room.code, rotated.code);
    const other = await c.rpc("recover");
    assert.equal(other.open, true);
    assert.equal(other.peerId, third.peerId);
    assert.equal(other.room.epoch, 2);
    await new Promise((resolve) => setTimeout(resolve, 5500));
    assert.equal(
      (await b.rpc("recover")).open,
      true,
      "new authority retains majority-backed service beyond its initial election lease",
    );
  },
);

test(
  "an isolated old authority loses its write lease while the remaining majority migrates over WSS",
  { timeout: 45000 },
  async (t) => {
    const a = await participant(t),
      b = await participant(t),
      c = await participant(t);
    t.after(async () => {
      await Promise.all([a, b, c].map((p) => stop(p.process)));
    });
    const first = await a.rpc("create");
    await b.rpc("join", { route: a.ready.route, code: first.room.code });
    await c.rpc("join", { route: a.ready.route, code: first.room.code });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await a.rpc("partition");
    await new Promise((resolve) => setTimeout(resolve, 5600));
    await assert.rejects(a.rpc("lock"), /temporary_(authority_lease_expired|join_required)/);
    await b.rpc("disconnect");
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal((await b.rpc("recover")).room.epoch, 2);
  },
);

test(
  "one surviving process cannot invent a majority or a replacement Session",
  { timeout: 35000 },
  async (t) => {
    const a = await participant(t),
      b = await participant(t),
      c = await participant(t);
    t.after(async () => {
      await Promise.all([a, b, c].map((p) => stop(p.process)));
    });
    const first = await a.rpc("create");
    await b.rpc("join", { route: a.ready.route, code: first.room.code });
    await c.rpc("join", { route: a.ready.route, code: first.room.code });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await Promise.all([stop(a.process), stop(c.process)]);
    await assert.rejects(b.rpc("recover"), /temporary_replica_quorum_required/);
    const state = await b.rpc("state");
    assert.equal(state.sessionId, first.roomId);
    assert.equal(state.epoch, 1);
  },
);
