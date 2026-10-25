/* eslint-disable @typescript-eslint/no-require-imports */
/* global require, process, console, setTimeout, clearTimeout */
const { app } = require("electron");
require("./electron-isolated-profile.cjs").configureIsolatedProfile(app, "temporary-room-smoke");
const deadline = setTimeout(() => {
  console.error("temporary_smoke_timeout");
  app.exit(1);
}, 60000);
app.whenReady().then(async () => {
  require("tsx/cjs");
  const { createServer } = require("node:https");
  const { request } = require("node:https");
  const { createLanCertificate } = require("../src/main/temporary-lan-certificate.ts");
  const assert = require("node:assert/strict");
  let server;
  let host, discovery, creator, guest, guestHost, guestDiscovery, publicGuest;
  let stage = "certificate-generation";
  try {
    const certificate = createLanCertificate();
    server = createServer(certificate, (_req, response) => response.end("ok"));
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    stage = "tls-handshake";
    await new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          ca: certificate.cert,
          servername: "shanghao.local",
          rejectUnauthorized: true,
          timeout: 3000,
        },
        (response) => {
          response.resume();
          response.once("end", resolve);
        },
      );
      req.once("error", reject);
      req.once("timeout", () => req.destroy(Error("tls_timeout")));
      req.end();
    });
    await new Promise((resolve) => server.close(resolve));
    server = undefined;
    const { TemporaryLanDiscovery } = require("../src/main/temporary-lan-discovery.ts");
    const { TemporaryLanHost } = require("../src/main/temporary-lan-host.ts");
    const { TemporaryRoomClient } = require("../src/main/temporary-room-client.ts");
    const { createTemporaryRoomRouter } = require("../src/main/temporary-room-router.ts");
    const { temporaryTestIdentity } = require("./helpers/temporary-test-identity.ts");
    const {
      APP_BUILD_NUMBER,
      APP_PROTOCOL_VERSION,
      OFFICIAL_RELAY_SERVER_URL,
    } = require("@private-voice/shared");
    const identity = temporaryTestIdentity("隔离主持");
    discovery = new TemporaryLanDiscovery({
      bindAddress: "127.0.0.1",
      port: 0,
      allowLoopback: true,
      targets: [],
    });
    host = new TemporaryLanHost({ identity, discovery, bindAddress: "127.0.0.1" });
    const endpoint = () =>
      process.env.SHANGHAO_TEMPORARY_PUBLIC_PROBE === "1" ? OFFICIAL_RELAY_SERVER_URL : "";
    creator = new TemporaryRoomClient(
      identity,
      endpoint,
      undefined,
      createTemporaryRoomRouter({ identity, discovery, host, endpoint }),
    );
    stage = "create-room";
    const first = await creator.create();
    assert.match(first.room.code, /^\d{8}$/);
    const route = await host.start();
    const guestIdentity = temporaryTestIdentity("隔离访客");
    guestDiscovery = new TemporaryLanDiscovery({
      bindAddress: "127.0.0.1",
      port: 0,
      allowLoopback: true,
      targets: [],
    });
    guestHost = new TemporaryLanHost({
      identity: guestIdentity,
      discovery: guestDiscovery,
      bindAddress: "127.0.0.1",
    });
    const guestRouter = createTemporaryRoomRouter({
      identity: guestIdentity,
      discovery: guestDiscovery,
      host: guestHost,
      endpoint,
    });
    guest = new TemporaryRoomClient(guestIdentity, () => route.url, undefined, {
      ...guestRouter,
      resolve: async () => route,
    });
    stage = "join-room";
    const second = await guest.join(first.room.code);
    assert.equal(second.roomId, first.roomId);
    assert.equal(second.room.members.length, 2);
    const next = (socket, type) =>
      new Promise((resolve, reject) => {
        const receive = (raw) => {
          const value = JSON.parse(raw.toString());
          if (value.type === type) {
            clearTimeout(timer);
            socket.off("message", receive);
            resolve(value);
          }
        };
        const timer = setTimeout(() => {
          socket.off("message", receive);
          reject(Error("temporary_smoke_message_timeout"));
        }, 5000);
        socket.on("message", receive);
      });
    const a = await creator.acquire(first.signalingUrl),
      b = await guest.acquire(second.signalingUrl);
    stage = "media-admission";
    for (const [socket, descriptor] of [
      [a, first],
      [b, second],
    ]) {
      const ack = next(socket, "join_ack");
      socket.send(
        JSON.stringify({
          type: "join_channel",
          roomId: first.roomId,
          channelId: first.roomId,
          peerId: descriptor.peerId,
          nickname: descriptor.nickname,
          avatarId: descriptor.avatarId,
          appVersion: require("../package.json").version,
          protocolVersion: APP_PROTOCOL_VERSION,
          buildNumber: APP_BUILD_NUMBER,
        }),
      );
      assert.equal((await ack).roomId, first.roomId);
    }
    const chat = next(b, "chat_message");
    a.send(
      JSON.stringify({
        type: "chat_message",
        roomId: first.roomId,
        peerId: first.peerId,
        content: "隔离运行时连接检查",
        clientMessageId: "electron-smoke",
      }),
    );
    assert.equal((await chat).peerId, first.peerId);
    let publicBridge;
    if (process.env.SHANGHAO_TEMPORARY_PUBLIC_PROBE === "1") {
      stage = "public-bridge";
      const publicIdentity = temporaryTestIdentity("隔离公网访客");
      const noLan = { start: async () => {}, lookup: async () => undefined };
      const publicHost = {
        configureInternet() {},
        onConnectivity() {
          return () => {};
        },
        joined: async () => undefined,
        left() {},
      };
      publicGuest = new TemporaryRoomClient(
        publicIdentity,
        endpoint,
        undefined,
        createTemporaryRoomRouter({
          identity: publicIdentity,
          discovery: noLan,
          host: publicHost,
          endpoint,
        }),
      );
      const third = await publicGuest.join(first.room.code);
      assert.equal(third.roomId, first.roomId);
      assert.equal(third.room.members.length, 3);
      publicBridge = true;
    }
    console.log(
      JSON.stringify({
        electron: process.versions.electron,
        loopbackTls: "passed",
        trustVerified: true,
        roomCreated: true,
        guestJoined: true,
        mediaAdmission: true,
        chatDelivered: true,
        publicBridge,
        syntheticOnly: true,
      }),
    );
    clearTimeout(deadline);
    publicGuest?.close();
    guest.close();
    creator.close();
    await guestHost.close();
    await guestDiscovery.stop();
    await host.close();
    await discovery.stop();
    app.exit(0);
  } catch (error) {
    console.error(JSON.stringify({ stage, code: error.code, message: error.message }));
    clearTimeout(deadline);
    publicGuest?.close();
    guest?.close();
    creator?.close();
    if (guestHost) await guestHost.close();
    if (guestDiscovery) await guestDiscovery.stop();
    if (host) await host.close();
    if (discovery) await discovery.stop();
    if (server) server.close();
    app.exit(1);
  }
});
