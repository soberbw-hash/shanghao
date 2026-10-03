import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import {
  roomMemoryContext,
  roomAutomaticMemoryText,
  isRoomMemorySnapshot,
  isRoomAiScopeAllowed,
  APP_PROTOCOL_VERSION,
  APP_BUILD_NUMBER,
  type AccountSnapshot,
  type RoomMemorySnapshot,
} from "@private-voice/shared";
import { RoomMemoryStore } from "../../../packages/signaling/src/room-memory-store";
import { RoomMemoryHttpController } from "../../../packages/signaling/src/room-memory-http-controller";
import { RoomMemoryRuntime } from "../../../packages/signaling/src/room-memory-runtime";
import { PrivateRoomDirectory } from "../../../packages/signaling/src/private-room-directory";
import { CloudAiService } from "../../../packages/signaling/src/cloud-ai-service";
import { SignalingServer } from "../../../packages/signaling/src/server";
import type { AccountBackend } from "../../../packages/signaling/src/account-service";
import type { PublishRecordingRecapMessage } from "../../../packages/signaling/src/protocol";
import { RoomMemoryDesktopService } from "../src/main/room-memory-service";
import { AiTextGateway } from "../src/main/ai-text-gateway";
import { mergeRoomMemoryDraft } from "../src/renderer/src/features/room/roomMemoryDraft";

const roomA = `room_${"a".repeat(32)}`,
  roomB = `room_${"b".repeat(32)}`;
const save = (memory: RoomMemorySnapshot, manualText = memory.manualText) => ({
  ...memory,
  manualText,
  entries: memory.entries.map(({ id, text }) => ({ id, text })),
});
const backend = {
  configured: true,
  verifyAccessToken: async (token: string) => {
    if (!["owner", "member", "outside"].includes(token)) throw new Error("account_session_expired");
    return { userId: token, username: token, displayName: token };
  },
} as AccountBackend;
const fixture = async (t: test.TestContext) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-room-memory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};
const source = {
  id: "recording-a",
  title: "2026-10-02 · 录音整理",
  text: "C文是陈文，Sober是房主。Sober喜欢辅助。",
};
const fact = { text: "C文是陈文", quote: "C文是陈文" };
const waitFor = async (check: () => boolean | Promise<boolean>) => {
  const deadline = Date.now() + 2500;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("condition_timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
test("unified automatic memory preserves legacy evidence, edits, new facts and room isolation", async (t) => {
  const file = path.join(await fixture(t), "unified.json");
  let store = await RoomMemoryStore.open(file);
  await store.add(roomA, 0, source, [fact]);
  let memory = store.get(roomA);
  assert.equal(roomAutomaticMemoryText(memory), fact.text);
  memory = await store.save({ ...save(memory), automaticText: "C文是陈文，常玩辅助。" });
  assert.equal(memory.entries[0]!.quote, fact.quote);
  const newFact = { text: "Sober是房主", quote: "Sober是房主" };
  await store.add(roomA, memory.revision, { ...source, id: "second" }, [fact, newFact]);
  memory = store.get(roomA);
  assert.equal(roomAutomaticMemoryText(memory), "C文是陈文，常玩辅助。\nSober是房主");
  assert.equal(store.get(roomB).entries.length, 0);
  assert.match(roomMemoryContext(memory), /C文是陈文，常玩辅助/);
  assert.doesNotMatch(roomMemoryContext(memory), /sourceTitle|录音整理/);
  store = await RoomMemoryStore.open(file);
  assert.deepEqual(store.get(roomA), memory);
  const old = store.get(roomA),
    draft = { ...old, automaticText: "我的修改" };
  await store.add(roomA, old.revision, { ...source, id: "third" }, [
    { text: "Sober喜欢辅助", quote: "Sober喜欢辅助" },
  ]);
  assert.equal(
    mergeRoomMemoryDraft(old, draft, store.get(roomA)).automaticText,
    "我的修改\nSober喜欢辅助",
  );
  const cleared = await store.save({ ...save(store.get(roomA)), automaticText: "" });
  assert.equal(cleared.entries.length, 0);
  await store.add(roomA, cleared.revision, { ...source, id: "fourth" }, [fact, newFact]);
  assert.equal(roomAutomaticMemoryText(store.get(roomA)), "");
  await assert.rejects(
    async () => store.save({ ...save(store.get(roomA)), automaticText: "x".repeat(8001) }),
    /room_memory_invalid/,
  );
});
test("private AI scope refuses legacy-to-private and private-to-private report access", () => {
  assert.equal(isRoomAiScopeAllowed("main", roomA), false);
  assert.equal(isRoomAiScopeAllowed(roomA, roomB), false);
  assert.equal(isRoomAiScopeAllowed(roomA, "main"), false);
  assert.equal(isRoomAiScopeAllowed(roomA, roomA), true);
  assert.equal(isRoomAiScopeAllowed("main", "side"), true);
});

test("draft refresh preserves edits and deletions while accepting untouched remote changes", async () => {
  const store = await RoomMemoryStore.open();
  await store.add(roomA, 0, source, [fact]);
  const base = store.get(roomA),
    draft = structuredClone(base);
  draft.manualText = "未保存的手工内容";
  draft.entries[0]!.text = "手工修正 C文";
  const latest = { ...structuredClone(base), revision: base.revision + 1, autoEnabled: false };
  latest.entries[0]!.text = "另一个客户端的修正";
  const merged = mergeRoomMemoryDraft(base, draft, latest);
  assert.equal(merged.manualText, draft.manualText);
  assert.equal(merged.entries[0]!.text, draft.entries[0]!.text);
  assert.equal(merged.autoEnabled, false);
  assert.equal(mergeRoomMemoryDraft(base, base, latest).entries[0]!.text, latest.entries[0]!.text);
  assert.equal(mergeRoomMemoryDraft(base, { ...draft, entries: [] }, latest).entries.length, 0);
  const orphan = mergeRoomMemoryDraft(base, draft, { ...latest, entries: [] });
  assert.match(orphan.manualText, /手工修正 C文/);
  assert.throws(
    () => mergeRoomMemoryDraft(base, draft, { ...latest, roomId: roomB }),
    /room_memory_conflict/,
  );
});

test("room memory persists atomically, isolates permanent room IDs, and rejects stale saves", async (t) => {
  const file = path.join(await fixture(t), "memory.json");
  let store = await RoomMemoryStore.open(file);
  const initial = store.get(roomA);
  assert.equal(initial.autoEnabled, true);
  const saved = await store.save(save(initial, "C文是陈文；Sober是房主。"));
  assert.equal(saved.revision, 1);
  assert.equal(store.get(roomB).manualText, "");
  await assert.rejects(() => store.save(save(initial, "stale")), /room_memory_conflict/);
  store = await RoomMemoryStore.open(file);
  assert.deepEqual(store.get(roomA), saved);
  const copy = store.get(roomA);
  copy.manualText = "mutated";
  assert.equal(store.get(roomA).manualText, saved.manualText);
  saved.entries.push({
    id: "c".repeat(64),
    text: "must not mutate persisted data",
    quote: fact.quote,
    sourceId: source.id,
    sourceTitle: source.title,
    updatedAt: new Date().toISOString(),
  });
  assert.equal(store.get(roomA).entries.length, 0);
  assert.ok(isRoomMemorySnapshot(saved));
  assert.doesNotMatch(JSON.stringify(saved), /rejected|sources/);
});

test("automatic facts require literal evidence, remain bounded, and never touch another room", async () => {
  const store = await RoomMemoryStore.open();
  await store.add(roomA, 0, source, [
    fact,
    { text: "Sober喜欢辅助", quote: "Sober喜欢辅助" },
    { text: "没有依据", quote: "这是虚构依据" },
    { text: "x".repeat(241), quote: fact.quote },
    null,
  ]);
  const memory = store.get(roomA);
  assert.equal(memory.entries.length, 2);
  assert.equal(memory.entries[0]!.quote, fact.quote);
  assert.equal(store.get(roomB).entries.length, 0);
  assert.equal(store.hasSource(roomA, source), true);
  await store.add(roomA, memory.revision, source, [fact]);
  assert.equal(store.get(roomA).revision, memory.revision);
  for (let i = 0; i < 5; i++) {
    const text = Array.from({ length: 8 }, (_, j) => `明确的事实 ${i}-${j}`).join("；");
    await store.add(
      roomA,
      store.get(roomA).revision,
      { id: `source${i}`, title: "来源", text },
      Array.from({ length: 8 }, (_, j) => ({
        text: `明确的事实 ${i}-${j}`,
        quote: `明确的事实 ${i}-${j}`,
      })),
    );
  }
  assert.equal(store.get(roomA).entries.length, 32);
});

test("human corrections, deletions, and disabling extraction survive later automatic results", async () => {
  const store = await RoomMemoryStore.open();
  await store.add(roomA, 0, source, [fact]);
  let memory = store.get(roomA);
  memory = await store.save({
    ...save(memory),
    entries: [{ id: memory.entries[0]!.id, text: "C文是成员陈文" }],
  });
  await store.add(roomA, memory.revision, { ...source, id: "different" }, [fact]);
  assert.equal(store.get(roomA).entries[0]!.text, "C文是成员陈文");
  memory = await store.save({ ...save(store.get(roomA)), entries: [] });
  await store.add(roomA, memory.revision, { ...source, id: "new" }, [fact]);
  assert.equal(store.get(roomA).entries.length, 0);
  const before = store.get(roomA);
  await store.save({ ...save(before, "手工文本"), autoEnabled: false });
  await store.add(roomA, before.revision, { ...source, id: "late" }, [fact]);
  assert.equal(store.get(roomA).manualText, "手工文本");
  assert.equal(store.get(roomA).entries.length, 0);
});

test("damaged and future memory formats stay untouched; failed writes publish no changes", async (t) => {
  const root = await fixture(t),
    file = path.join(root, "memory.json");
  for (const content of ["damaged", '{"version":999,"rooms":[]}']) {
    await writeFile(file, content);
    await assert.rejects(RoomMemoryStore.open(file));
    assert.equal(await readFile(file, "utf8"), content);
  }
  await writeFile(file, Buffer.alloc(16 * 1024 * 1024 + 1));
  await assert.rejects(RoomMemoryStore.open(file), /room_memory_full/);
  assert.equal((await readFile(file)).length, 16 * 1024 * 1024 + 1);
  const store = await RoomMemoryStore.open(path.join(root, "blocked", "memory.json"));
  await writeFile(path.join(root, "blocked"), "not a directory");
  await assert.rejects(store.save(save(store.get(roomA), "must not commit")));
  assert.equal(store.get(roomA).manualText, "");
  assert.equal(store.get(roomA).revision, 0);
});

test("malformed save input and forged automatic entry identities are rejected", async () => {
  const store = await RoomMemoryStore.open();
  const initial = store.get(roomA);
  for (const input of [
    { ...save(initial), manualText: "x".repeat(4001) },
    { ...save(initial), revision: -1 },
    { ...save(initial), entries: [{ id: "f".repeat(64), text: "forged" }] },
  ]) {
    await assert.rejects(async () => store.save(input), /room_memory_invalid/);
  }
  assert.equal(store.get(roomA).revision, 0);
  assert.equal(isRoomMemorySnapshot({ ...initial, entries: [{ id: "wrong" }] }), false);
});

const httpFixture = async (t: test.TestContext) => {
  const directory = await PrivateRoomDirectory.open();
  const a = await directory.create("owner", "A", {}),
    b = await directory.create("outside", "B", {});
  const store = await RoomMemoryStore.open();
  const joined = new Set([`member|${a.roomId}`]);
  const controller = new RoomMemoryHttpController(
    Promise.resolve(directory),
    Promise.resolve(store),
    backend,
    (id, user) => joined.has(`${user}|${id}`),
    () => true,
  );
  const server = createServer((request, response) => {
    void controller.handle(request, response).then((handled) => {
      if (!handled) {
        response.writeHead(404);
        response.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}`;
  const call = (id: string, user: string, method = "GET", body?: unknown) =>
    fetch(`${url}/api/rooms/${id}/memory`, {
      method,
      headers: { authorization: `Bearer ${user}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { directory, store, joined, a, b, call };
};

test("memory HTTP authorizes owners and present members, bans outsiders, and fixes URL room identity", async (t) => {
  const { a, b, store, directory, joined, call } = await httpFixture(t);
  const initial = store.get(a.roomId);
  assert.equal((await call(a.roomId, "outside")).status, 403);
  assert.equal((await call(a.roomId, "bad")).status, 401);
  assert.equal((await call(a.roomId, "member", "PUT", save(initial, "forbidden"))).status, 403);
  const response = await call(a.roomId, "owner", "PUT", {
    ...save(initial, "A 的记忆"),
    roomId: b.roomId,
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).roomId, a.roomId);
  assert.equal(store.get(b.roomId).manualText, "");
  const member = await call(a.roomId, "member");
  assert.equal(member.status, 200);
  assert.equal((await member.json()).manualText, "A 的记忆");
  assert.equal(member.headers.get("cache-control"), "no-store");
  assert.equal((await call(a.roomId, "owner", "PUT", save(initial, "stale"))).status, 409);
  assert.equal(
    (
      await call(a.roomId, "owner", "PUT", {
        ...save(store.get(a.roomId)),
        manualText: "x".repeat(4001),
      })
    ).status,
    400,
  );
  joined.clear();
  assert.equal((await call(a.roomId, "member")).status, 403);
  joined.add(`member|${a.roomId}`);
  await directory.ban(a.roomId, "owner", "member", "Member");
  assert.equal((await call(a.roomId, "member")).status, 403);
  await directory.delete(a.roomId, "owner");
  assert.equal((await call(a.roomId, "owner")).status, 404);
});

test("delayed memory readiness cannot grant a member who has already left", async (t) => {
  const directory = await PrivateRoomDirectory.open(),
    room = await directory.create("owner", "A", {});
  let resolveStore!: (value: RoomMemoryStore) => void,
    joined = true;
  const controller = new RoomMemoryHttpController(
    Promise.resolve(directory),
    new Promise((resolve) => {
      resolveStore = resolve;
    }),
    backend,
    () => joined,
    () => true,
  );
  const server = createServer((req, res) => void controller.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = fetch(`http://127.0.0.1:${address.port}/api/rooms/${room.roomId}/memory`, {
    headers: { authorization: "Bearer member" },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  joined = false;
  resolveStore(await RoomMemoryStore.open());
  assert.equal((await response).status, 403);
});

test("memory HTTP requires secure transport before any account verification", async () => {
  const controller = new RoomMemoryHttpController(
    PrivateRoomDirectory.open(),
    RoomMemoryStore.open(),
    backend,
    () => true,
    () => false,
  );
  let status = 0;
  const response = {
    setHeader: () => {},
    writeHead: (code: number) => {
      status = code;
    },
    end: () => {},
    destroyed: false,
  };
  await controller.handle(
    { url: `/api/rooms/${roomA}/memory`, headers: {}, socket: {} } as IncomingMessage,
    response as never,
  );
  assert.equal(status, 426);
});

test("desktop memory service hides tokens and rejects cross-room, account, and server replies", async () => {
  let snapshot: AccountSnapshot = {
    status: "signed_in",
    configured: true,
    guestAllowed: false,
    profile: { userId: "owner", username: "owner", displayName: "Owner" },
  };
  let server = "wss://rooms.test",
    seen = "";
  const initial = (await RoomMemoryStore.open()).get(roomA);
  const service = new RoomMemoryDesktopService(
    { getSnapshot: () => snapshot, getFreshAccessToken: async () => "secret" },
    () => server,
    async (url, init) => {
      seen = String(url);
      assert.equal((init?.headers as Record<string, string>).authorization, "Bearer secret");
      return Response.json(initial);
    },
  );
  assert.deepEqual(await service.get(roomA), initial);
  assert.equal(seen, `https://rooms.test/api/rooms/${roomA}/memory`);
  const bad = new RoomMemoryDesktopService(
    { getSnapshot: () => snapshot, getFreshAccessToken: async () => "secret" },
    () => server,
    async () => Response.json({ ...initial, roomId: roomB }),
  );
  await assert.rejects(bad.get(roomA), /room_server_invalid_response/);
  const late = new RoomMemoryDesktopService(
    { getSnapshot: () => snapshot, getFreshAccessToken: async () => "secret" },
    () => server,
    async () => {
      snapshot = {
        ...snapshot,
        profile: { userId: "other", username: "other", displayName: "Other" },
      };
      return Response.json(initial);
    },
  );
  await assert.rejects(late.get(roomA), /account_session_expired/);
  const moved = new RoomMemoryDesktopService(
    { getSnapshot: () => snapshot, getFreshAccessToken: async () => "secret" },
    () => server,
    async () => {
      server = "wss://different.test";
      return Response.json(initial);
    },
  );
  await assert.rejects(moved.get(roomA), /account_session_expired/);
  await assert.rejects(
    async () => service.save({ ...save(initial), manualText: "x".repeat(4001) }),
    /room_memory_invalid/,
  );
});

test("older servers show a memory upgrade notice while custom AI keeps its previous behavior", async () => {
  const directory = await PrivateRoomDirectory.open(),
    room = await directory.create("owner", "A", {});
  const snapshot: AccountSnapshot = {
    status: "signed_in",
    configured: true,
    guestAllowed: false,
    profile: { userId: "owner", username: "owner", displayName: "Owner" },
  };
  const service = new RoomMemoryDesktopService(
    { getSnapshot: () => snapshot, getFreshAccessToken: async () => "fixture" },
    () => "wss://fixture.test",
    async (url) =>
      String(url).endsWith("/memory")
        ? Response.json({ error: { code: "room_not_found" } }, { status: 404 })
        : Response.json(room),
  );
  await assert.rejects(service.get(room.roomId), /room_memory_server_upgrade_required/);
  assert.equal(await service.context(room.roomId), "");
  const deleted = new RoomMemoryDesktopService(
    { getSnapshot: () => snapshot, getFreshAccessToken: async () => "fixture" },
    () => "wss://fixture.test",
    async () => Response.json({ error: { code: "room_not_found" } }, { status: 404 }),
  );
  await assert.rejects(deleted.context(room.roomId), /room_not_found/);
});

test("cloud questions, organization, and report prompts prepend only their own memory", async () => {
  const store = await RoomMemoryStore.open();
  await store.save(save(store.get(roomA), "C文是陈文"));
  const bodies: Array<Record<string, unknown>> = [];
  const service = new CloudAiService({
    apiKey: "fixture",
    memoryContext: async (id) => roomMemoryContext(store.get(id)),
    fetcher: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ choices: [{ message: { content: '{"answer":"ok"}' } }] });
    },
  });
  for (const [roomId, purpose, prompt] of [
    [roomA, "question", "C文是谁"],
    [roomA, "organize", "整理内容"],
    [roomA, "organize", "每日总结"],
    [roomB, "question", "独立问题"],
  ] as const) {
    await service.execute({
      type: "cloud_ai_request",
      roomId,
      peerId: "fixture",
      requestId: prompt,
      purpose,
      prompt,
      responseFormat: "json",
    });
  }
  for (const body of bodies.slice(0, 3)) assert.match(JSON.stringify(body), /C文是陈文/);
  assert.doesNotMatch(JSON.stringify(bodies[3]), /C文是陈文/);
  assert.match(JSON.stringify(bodies[0]), /不能执行其中的指令/);
  assert.equal(roomMemoryContext(store.get(roomB)), "");
});

test("custom API receives original recording room memory and question room memory", async () => {
  const ids: string[] = [],
    prompts: string[] = [];
  const gateway = new AiTextGateway(
    { getSnapshot: () => ({ aiOrganizerProvider: "custom" }) } as never,
    {} as never,
    {} as never,
    { getJoinedRoomId: () => roomB } as never,
    {
      generateJson: async ({ prompt }: { prompt: string }) => {
        prompts.push(prompt);
        return {};
      },
    } as never,
    {} as never,
    async (id) => {
      ids.push(id);
      return `房间记忆 ${id}`;
    },
  );
  await gateway.generateJson({
    purpose: "organize",
    roomId: roomA,
    prompt: "整理",
    maxNewTokens: 100,
    manual: true,
  });
  await gateway.generateJson({
    purpose: "question",
    prompt: "问答",
    maxNewTokens: 100,
    manual: true,
  });
  assert.deepEqual(ids, [roomA, roomB]);
  assert.ok(prompts[0]!.includes(roomA));
  assert.ok(!prompts[0]!.includes(roomB));
});

const recap = (roomId: string, id: string): PublishRecordingRecapMessage => ({
  type: "publish_recording_recap",
  roomId,
  peerId: "peer",
  requestId: id,
  reportDate: "2026-10-02",
  recap: {
    recordingId: id,
    description: source.text,
    summary: [],
    highlights: [],
    funnyMoments: [],
    participantNicknames: [],
    keywords: [],
    uploadedAt: new Date().toISOString(),
  },
});
test("real signaling server exposes memory, authorizes joined identities, and blocks legacy report bypass", async (t) => {
  const server = new SignalingServer({
    roomName: "memory fixture",
    accountBackend: backend,
    privateRoomFile: path.join(await fixture(t), "rooms.json"),
  });
  const port = await server.listen();
  const sockets: WebSocket[] = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await server.close();
  });
  const base = `http://127.0.0.1:${port}/api/rooms`;
  const created = await fetch(base, {
    method: "POST",
    headers: { authorization: "Bearer owner", "content-type": "application/json" },
    body: JSON.stringify({ name: "A", channelCode: "666666" }),
  });
  const room = await created.json();
  assert.equal(created.status, 201);
  const url = `${base}/${room.roomId}/memory`;
  const initial = await (await fetch(url, { headers: { authorization: "Bearer owner" } })).json();
  assert.equal(
    (
      await fetch(url, {
        method: "PUT",
        headers: { authorization: "Bearer owner", "content-type": "application/json" },
        body: JSON.stringify(save(initial, "只有 A 房间可以读")),
      })
    ).status,
    200,
  );
  assert.equal((await fetch(url, { headers: { authorization: "Bearer member" } })).status, 403);
  const next = (socket: WebSocket, type: string) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off("message", receive);
        reject(new Error("message_timeout"));
      }, 2000);
      const receive = (raw: Buffer) => {
        const message = JSON.parse(raw.toString());
        if (message.type === type) {
          clearTimeout(timer);
          socket.off("message", receive);
          resolve(message);
        }
      };
      socket.on("message", receive);
    });
  const join = async (id: string, user: string) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { authorization: `Bearer ${user}` },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    const joined = next(socket, "join_ack");
    socket.send(
      JSON.stringify({
        type: "join_channel",
        roomId: id,
        channelId: id,
        peerId: `peer-${user}`,
        profileId: `profile-${user}`,
        nickname: user,
        avatarId: "fox",
        appVersion: "3.4.1",
        protocolVersion: APP_PROTOCOL_VERSION,
        buildNumber: APP_BUILD_NUMBER,
      }),
    );
    await joined;
    return socket;
  };
  await join(room.roomId, "member");
  const read = await fetch(url, { headers: { authorization: "Bearer member" } });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).manualText, "只有 A 房间可以读");
  const legacy = await join("main", "outside"),
    denied = next(legacy, "error");
  legacy.send(
    JSON.stringify({
      type: "request_daily_room_reports",
      roomId: "main",
      targetRoomId: room.roomId,
      peerId: "peer-outside",
    }),
  );
  assert.equal((await denied).code, "room_owner_required");
});

test("automatic extraction serializes each room, deduplicates sources, and honors the off switch", async (t) => {
  const directory = await PrivateRoomDirectory.open(),
    room = await directory.create("owner", "A", {});
  let calls = 0,
    active = 0,
    peak = 0;
  const runtime = new RoomMemoryRuntime(
    Promise.resolve(directory),
    backend,
    () => true,
    () => true,
    path.join(await fixture(t), "memory.json"),
    {
      isConfigured: () => true,
      execute: async () => {
        calls++;
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 25));
        active--;
        return JSON.stringify({ facts: [fact] });
      },
    },
  );
  t.after(() => runtime.close());
  runtime.observeRecap(recap(room.roomId, "first"));
  runtime.observeRecap(recap(room.roomId, "second"));
  await waitFor(() => calls === 2 && active === 0);
  assert.equal(peak, 1);
  assert.match(await runtime.context(room.roomId), /C文是陈文/);
  runtime.observeRecap(recap(room.roomId, "first"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls, 2);
  await directory.delete(room.roomId, "owner");
  await assert.rejects(runtime.context(room.roomId), /room_not_found/);
  assert.equal(await runtime.context("main"), "");
});

test("automatic extraction cannot overwrite manual saves, and close cancels pending inference", async (t) => {
  const directory = await PrivateRoomDirectory.open(),
    room = await directory.create("owner", "A", {}),
    file = path.join(await fixture(t), "memory.json");
  let release!: (value: string) => void,
    started = false;
  const runtime = new RoomMemoryRuntime(
    Promise.resolve(directory),
    backend,
    () => true,
    () => true,
    file,
    {
      isConfigured: () => true,
      execute: async (_request, signal) => {
        started = true;
        return new Promise<string>((resolve, reject) => {
          release = resolve;
          signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    },
  );
  t.after(() => runtime.close());
  // Exercise the real HTTP path to edit the very store used by the runtime.
  const server = createServer((req, res) => void runtime.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/api/rooms/${room.roomId}/memory`;
  runtime.observeRecap(recap(room.roomId, "first"));
  await waitFor(() => started);
  const memory = await (await fetch(url, { headers: { authorization: "Bearer owner" } })).json();
  assert.equal(
    (
      await fetch(url, {
        method: "PUT",
        headers: { authorization: "Bearer owner", "content-type": "application/json" },
        body: JSON.stringify({ ...save(memory, "手动为准"), autoEnabled: false }),
      })
    ).status,
    200,
  );
  release(JSON.stringify({ facts: [fact] }));
  await new Promise((resolve) => setTimeout(resolve, 30));
  let result = await (await fetch(url, { headers: { authorization: "Bearer owner" } })).json();
  assert.equal(result.entries.length, 0);
  assert.equal(result.manualText, "手动为准");
  started = false;
  runtime.observeRecap(recap(room.roomId, "disabled"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(started, false);
  await fetch(url, {
    method: "PUT",
    headers: { authorization: "Bearer owner", "content-type": "application/json" },
    body: JSON.stringify({ ...save(result), autoEnabled: true }),
  });
  runtime.observeRecap(recap(room.roomId, "cancelled"));
  await waitFor(() => started);
  await runtime.close();
  result = (await RoomMemoryStore.open(file)).get(room.roomId);
  assert.equal(result.entries.length, 0);
});
