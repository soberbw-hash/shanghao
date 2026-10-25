import assert from "node:assert/strict";
import { createServer } from "node:https";
import test from "node:test";
import { SignalingServer } from "../../../packages/signaling/src/server";
import { TemporaryLanDiscovery } from "../src/main/temporary-lan-discovery";
import { TemporaryLanHost } from "../src/main/temporary-lan-host";
import { TemporaryRoomClient } from "../src/main/temporary-room-client";
import { createLanCertificate } from "../src/main/temporary-lan-certificate";
import { TemporaryInternetProvider } from "../src/main/temporary-internet-provider";
import {
  TemporaryInternetConnection,
  openInternetRoomSocket,
} from "../src/main/temporary-internet-connection";
import { temporaryTestIdentity } from "./helpers/temporary-test-identity";
import { createHash, X509Certificate } from "node:crypto";
import { createTemporaryRoomRouter } from "../src/main/temporary-room-router";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION } from "@private-voice/shared";

const nextMessage = (socket: WebSocket, type: string): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("message", receive);
      reject(Error("message_timeout:" + type));
    }, 3000);
    const receive = (raw: import("ws").RawData) => {
      const message = JSON.parse(raw.toString());
      if (message.type === type) {
        clearTimeout(timer);
        socket.off("message", receive);
        resolve(message);
      }
    };
    socket.on("message", receive);
  });

test(
  "reverse WSS tunnel retains inner TLS pin and reaches the same actual LAN coordinator",
  { timeout: 20000 },
  async (t) => {
    const cert = createLanCertificate(),
      https = createServer({ cert: cert.cert, key: cert.key });
    const broker = new SignalingServer({
      roomName: "isolated broker",
      httpServer: https,
      host: "127.0.0.1",
      accountBackend: { configured: false } as never,
    });
    const brokerPort = await broker.listen();
    t.after(() => broker.close());
    const endpoint = { url: `wss://127.0.0.1:${brokerPort}/temporary`, certificate: cert.cert };
    const identity = temporaryTestIdentity("主持"),
      guest = temporaryTestIdentity("访客");
    const discovery = new TemporaryLanDiscovery({
      bindAddress: "127.0.0.1",
      port: 0,
      allowLoopback: true,
      targets: [],
    });
    const host = new TemporaryLanHost({ identity, discovery, bindAddress: "127.0.0.1" });
    const route = await host.start();
    const local = new TemporaryRoomClient(identity, () => route.url, undefined, {
      resolve: async () => route,
      joined: (r, s) => host.replication.joined(r, s),
    });
    t.after(async () => {
      local.close();
      await host.close();
      await discovery.stop();
    });
    const first = await local.create(),
      profile = (await identity.getProfile())!;
    const issuedAt = Date.now();
    const signed = await identity.signInternetRegistration({
      version: 1,
      sessionId: first.roomId,
      authorityId: profile.deviceId,
      publicKey: profile.publicKey,
      epoch: first.room.epoch,
      revision: first.room.revision,
      code: first.room.code,
      members: first.room.members.map((m) => ({ deviceId: m.deviceId, publicKey: m.publicKey })),
      certificateSha256: createHash("sha256")
        .update(new X509Certificate(route.certificate!).raw)
        .digest("hex"),
      issuedAt,
      expiresAt: issuedAt + 15000,
    });
    const provider = new TemporaryInternetProvider(
      identity,
      endpoint,
      Number(new URL(route.url).port),
    );
    t.after(() => provider.close());
    await provider.publish(signed, "authority");
    const lookup = new TemporaryInternetConnection(guest, endpoint);
    t.after(() => lookup.close());
    assert.deepEqual(await lookup.request("lookup", { code: first.room.code }), signed);
    const internetRoute = {
      broker: endpoint,
      sessionId: first.roomId,
      deviceId: profile.deviceId,
      registration: signed,
    };
    const tunneled = new TemporaryRoomClient(
      guest,
      () => endpoint.url,
      () => openInternetRoomSocket(guest, internetRoute),
    );
    t.after(() => tunneled.close());
    const second = await tunneled.join(first.room.code);
    assert.equal(second.roomId, first.roomId);
    assert.equal(second.room.members.length, 2);
    assert.equal(second.room.authorityId, first.room.authorityId);
    const socket = await tunneled.acquire(second.signalingUrl);
    assert.equal(socket?.readyState, 1);
    const localSocket = (await local.acquire(first.signalingUrl))!;
    for (const [media, descriptor] of [
      [localSocket, first],
      [socket!, second],
    ] as const) {
      const ack = nextMessage(media, "join_ack");
      media.send(
        JSON.stringify({
          type: "join_channel",
          roomId: first.roomId,
          channelId: first.roomId,
          peerId: descriptor.peerId,
          nickname: descriptor.nickname,
          avatarId: descriptor.avatarId,
          appVersion: "3.4.13",
          protocolVersion: APP_PROTOCOL_VERSION,
          buildNumber: APP_BUILD_NUMBER,
        }),
      );
      assert.equal((await ack).roomId, first.roomId);
    }
    const chat = nextMessage(socket!, "chat_message"),
      ack = nextMessage(localSocket, "chat_ack");
    localSocket.send(
      JSON.stringify({
        type: "chat_message",
        roomId: first.roomId,
        peerId: "forged",
        content: "隔离 LAN 到公网管道",
        clientMessageId: "mixed-route",
      }),
    );
    assert.equal((await chat).peerId, first.peerId);
    assert.equal((await ack).clientMessageId, "mixed-route");
    const offer = nextMessage(localSocket, "peer_offer");
    socket!.send(
      JSON.stringify({
        type: "peer_offer",
        roomId: first.roomId,
        peerId: second.peerId,
        targetPeerId: first.peerId,
        sdp: { type: "offer", sdp: "synthetic-test-sdp" },
      }),
    );
    assert.equal((await offer).peerId, second.peerId);
  },
);

test(
  "Main router publishes a local Session and internet-only discovery joins it through pinned inner TLS",
  { timeout: 25000 },
  async (t) => {
    const cert = createLanCertificate(),
      https = createServer({ cert: cert.cert, key: cert.key });
    const broker = new SignalingServer({
      roomName: "isolated index",
      httpServer: https,
      host: "127.0.0.1",
      accountBackend: { configured: false } as never,
    });
    const port = await broker.listen();
    t.after(() => broker.close());
    const endpoint = { url: `wss://127.0.0.1:${port}/temporary`, certificate: cert.cert };
    const participants = await Promise.all(
      ["主持", "公网朋友"].map(async (nickname) => {
        const identity = temporaryTestIdentity(nickname),
          discovery = new TemporaryLanDiscovery({
            bindAddress: "127.0.0.1",
            port: 0,
            allowLoopback: true,
            targets: [],
          });
        const host = new TemporaryLanHost({ identity, discovery, bindAddress: "127.0.0.1" });
        const router = createTemporaryRoomRouter({
          identity,
          discovery,
          host,
          endpoint: () => endpoint.url,
          internetEndpoint: () => endpoint,
        });
        const client = new TemporaryRoomClient(identity, () => endpoint.url, undefined, router);
        t.after(async () => {
          client.close();
          await host.close();
          await discovery.stop();
        });
        return { client, host };
      }),
    );
    const first = await participants[0]!.client.create();
    const second = await participants[1]!.client.join(first.room.code);
    assert.equal(second.roomId, first.roomId);
    assert.equal(second.room.members.length, 2);
    assert.equal(JSON.stringify(second).includes("certificateSha256"), false);
    assert.equal(JSON.stringify(second).includes("secret"), false);
  },
);

test(
  "large inner frames remain byte-exact through bounded encrypted outer frames",
  { timeout: 15000 },
  async (t) => {
    const brokerCert = createLanCertificate(),
      brokerHttps = createServer({ cert: brokerCert.cert, key: brokerCert.key });
    const broker = new SignalingServer({
      roomName: "isolated byte broker",
      httpServer: brokerHttps,
      host: "127.0.0.1",
      accountBackend: { configured: false } as never,
    });
    const port = await broker.listen();
    t.after(() => broker.close());
    const endpoint = { url: `wss://127.0.0.1:${port}/temporary`, certificate: brokerCert.cert };
    const cert = createLanCertificate(),
      local = createServer({ cert: cert.cert, key: cert.key }),
      echo = new WebSocketServer({ server: local, maxPayload: 2 * 1024 * 1024 });
    echo.on("connection", (socket) =>
      socket.on("message", (raw, binary) => socket.send(raw, { binary })),
    );
    await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
    t.after(async () => {
      for (const client of echo.clients) client.terminate();
      await new Promise<void>((resolve) => local.close(() => resolve()));
    });
    const identity = temporaryTestIdentity(),
      profile = (await identity.getProfile())!,
      sessionId = "temp_" + "e".repeat(32);
    const issuedAt = Date.now();
    const signed = await identity.signInternetRegistration({
      version: 1,
      sessionId,
      authorityId: profile.deviceId,
      publicKey: profile.publicKey,
      epoch: 1,
      revision: 1,
      code: "13572468",
      members: [profile],
      certificateSha256: cert.sha256,
      issuedAt,
      expiresAt: issuedAt + 15000,
    });
    const provider = new TemporaryInternetProvider(
      identity,
      endpoint,
      (local.address() as import("node:net").AddressInfo).port,
    );
    t.after(() => provider.close());
    await provider.publish(signed, "authority");
    const socket = await openInternetRoomSocket(temporaryTestIdentity("字节客户端"), {
      broker: endpoint,
      sessionId,
      deviceId: profile.deviceId,
      registration: signed,
    });
    t.after(() => socket.terminate());
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    for (const size of [230 * 1024, 1300 * 1024]) {
      const bytes = Buffer.alloc(size, 47);
      const received = new Promise<Buffer>((resolve, reject) => {
        socket.once("message", (data) => resolve(Buffer.from(data as Buffer)));
        socket.once("close", () => reject(Error("inner_socket_closed")));
      });
      socket.send(bytes);
      assert.deepEqual(await received, bytes);
    }
  },
);
