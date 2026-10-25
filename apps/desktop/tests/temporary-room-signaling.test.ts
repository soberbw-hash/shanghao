import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { SignalingServer } from "../../../packages/signaling/src/server";
import {
  temporaryAuthSigningPayload,
  type TemporaryAuthChallenge,
  type TemporaryRoomAdmission,
} from "../../../packages/shared/src/types/temporary-room.types";
import { APP_BUILD_NUMBER, APP_PROTOCOL_VERSION, BUILT_IN_AVATAR_IDS } from "@private-voice/shared";

type Message = Record<string, unknown>;
const next = (socket: WebSocket, match: (value: Message) => boolean): Promise<Message> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(Error("message_timeout"));
    }, 3000);
    const receive = (raw: Buffer) => {
      const message = JSON.parse(raw.toString());
      if (match(message)) {
        cleanup();
        resolve(message);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", receive);
    };
    socket.on("message", receive);
  });
let request = 0;
async function rpc(socket: WebSocket, data: Message): Promise<unknown> {
  const requestId = `fixture-${++request}`;
  const pending = next(
    socket,
    (value) => value.type === "temporary_room_response" && value.requestId === requestId,
  );
  socket.send(JSON.stringify({ type: "temporary_room_request", version: 1, requestId, ...data }));
  const result = await pending;
  if (!result.ok) throw Error(String(result.code));
  return result.value;
}
async function client(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/temporary`, {
    headers: { "x-forwarded-proto": "https" },
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    socket,
    proof: async (sessionId?: string) => {
      const challenge = (await rpc(socket, {
        command: "challenge",
        publicKey,
        sessionId,
      })) as TemporaryAuthChallenge;
      return {
        challengeId: challenge.challengeId,
        publicKey,
        signature: sign(
          null,
          Buffer.from(temporaryAuthSigningPayload(challenge)),
          pair.privateKey,
        ).toString("base64url"),
      };
    },
  };
}
async function joinMedia(socket: WebSocket, admission: TemporaryRoomAdmission) {
  const joined = next(socket, (value) => value.type === "join_ack");
  socket.send(
    JSON.stringify({
      type: "join_channel",
      roomId: admission.room.sessionId,
      channelId: admission.room.sessionId,
      peerId: admission.member.memberId,
      nickname: admission.member.profile.nickname,
      avatarId: BUILT_IN_AVATAR_IDS[0],
      appVersion: "3.4.13",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
    }),
  );
  return joined;
}

test("temporary device proof joins the existing media signaling and never persists room history", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-temporary-wire-"));
  const previousHistory = process.env.CHAT_HISTORY_FILE;
  process.env.CHAT_HISTORY_FILE = path.join(root, "history.json");
  const server = new SignalingServer({
    roomName: "fixture",
    privateRoomFile: path.join(root, "rooms.json"),
    dailyRoomReportFile: path.join(root, "daily.json"),
    accountBackend: { configured: false } as never,
  });
  const sockets: WebSocket[] = [];
  t.after(async () => {
    sockets.forEach((socket) => socket.terminate());
    await server.close();
    if (previousHistory === undefined) delete process.env.CHAT_HISTORY_FILE;
    else process.env.CHAT_HISTORY_FILE = previousHistory;
    await rm(root, { recursive: true, force: true });
  });
  const port = await server.listen();
  const a = await client(port);
  sockets.push(a.socket);
  const forbidden = next(a.socket, (value) => value.type === "error");
  a.socket.send(
    JSON.stringify({
      type: "join_channel",
      roomId: "main",
      channelId: "main",
      peerId: "unverified",
      nickname: "测试",
      avatarId: BUILT_IN_AVATAR_IDS[0],
      appVersion: "3.4.13",
      protocolVersion: APP_PROTOCOL_VERSION,
      buildNumber: APP_BUILD_NUMBER,
    }),
  );
  assert.equal((await forbidden).code, "temporary_membership_required");
  const first = (await rpc(a.socket, {
    command: "create",
    profile: { nickname: "甲" },
    proof: await a.proof(),
  })) as TemporaryRoomAdmission;
  assert.match(first.room.code, /^\d{8}$/);
  await joinMedia(a.socket, first);
  const b = await client(port);
  sockets.push(b.socket);
  const resolved = (await rpc(b.socket, {
    command: "resolve",
    code: first.room.code,
    proof: await b.proof(),
  })) as { sessionId: string };
  const second = (await rpc(b.socket, {
    command: "join",
    code: first.room.code,
    profile: { nickname: "乙" },
    proof: await b.proof(resolved.sessionId),
  })) as TemporaryRoomAdmission;
  await joinMedia(b.socket, second);
  const chat = next(b.socket, (value) => value.type === "chat_message");
  const ack = next(a.socket, (value) => value.type === "chat_ack");
  a.socket.send(
    JSON.stringify({
      type: "chat_message",
      roomId: first.room.sessionId,
      peerId: "forged",
      content: "合成临时消息",
      clientMessageId: "one",
    }),
  );
  assert.equal((await chat).peerId, first.member.memberId);
  assert.equal((await ack).clientMessageId, "one");
  const blocked = next(b.socket, (value) => value.type === "error");
  b.socket.send(
    JSON.stringify({
      type: "request_daily_room_reports",
      roomId: first.room.sessionId,
      peerId: second.member.memberId,
      targetRoomId: "main",
    }),
  );
  assert.equal((await blocked).code, "temporary_cloud_storage_unavailable");
  const changed = next(
    b.socket,
    (value) =>
      value.type === "temporary_room_changed" &&
      (value.room as { adminMemberId?: string })?.adminMemberId === second.member.memberId,
  );
  a.socket.send(
    JSON.stringify({
      type: "leave_channel",
      roomId: first.room.sessionId,
      peerId: first.member.memberId,
    }),
  );
  await changed;
  const snapshot = (await rpc(b.socket, { command: "snapshot" })) as {
    members: unknown[];
    adminMemberId: string;
  };
  assert.equal(snapshot.members.length, 1);
  assert.equal(snapshot.adminMemberId, second.member.memberId);
  for (const file of ["history.json", "daily.json", "rooms.json"]) {
    const content = await readFile(path.join(root, file), "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    assert.equal(
      content.includes(first.room.sessionId),
      false,
      `${file} must not retain temporary rooms`,
    );
    assert.equal(content.includes("合成临时消息"), false);
  }
});
