import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import {
  RoomConnectionState,
  type ChatMessage,
  type VoiceMemorySearchResult,
} from "@private-voice/shared";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import {
  ASSISTANT_ANSWER_STYLE,
  assistantAnswerText,
  roomQuestionPrompt,
} from "../src/main/voice-memory-question-prompt";
import {
  chatDisplayName,
  gameAssistantMessageId,
  isGameAssistantMessage,
} from "../src/renderer/src/features/chat/gameAssistantMessage";
import { isSignalEnvelope } from "../../../packages/signaling/src/protocol";
import { ChatHistoryStore as RelayHistory } from "../../../packages/signaling/src/chat-history-store";
import { ChatHistoryStore as LocalHistory } from "../src/main/chat-history-store";

const candidate: VoiceMemorySearchResult = {
  recordingId: "recording-one",
  filePath: "recording-one.m4a",
  roomName: "朋友房间",
  createdAt: "2026-10-02T01:00:00.000Z",
  startMs: 1200,
  kind: "transcript",
  title: "约饭",
  excerpt: "明晚七点一起吃饭",
  score: 1,
};
const message: ChatMessage = {
  id: "message-one",
  peerId: "authenticated-peer",
  senderProfileId: "authenticated-profile",
  nickname: "Sober",
  content: "重点回答",
  createdAt: "2026-10-02T01:00:00.000Z",
};

test("all kinds of questions use the same concise style without an empty-memory preface", () => {
  for (const question of [
    "海克斯大乱斗卡莎出什么装？",
    "北京和上海有时差吗？",
    "昨天几点约饭？",
    "请详细解释每一步",
  ]) {
    const prompt = roomQuestionPrompt(question, []);
    for (const rule of ASSISTANT_ANSWER_STYLE) assert.equal(prompt.includes(rule), true);
    assert.equal(prompt.includes(`问题：${question}`), true);
    assert.equal(prompt.includes("可参考的语音片段："), false);
    assert.equal(prompt.includes("没有检索到相关语音记忆。"), false);
    assert.equal(prompt.includes("sources 返回空数组"), true);
  }
  const withMemory = roomQuestionPrompt("昨天几点约饭？", [candidate]);
  assert.equal(withMemory.includes("memory-1\t朋友房间"), true);
  assert.equal(withMemory.includes(candidate.excerpt), true);
});

test("answer cleanup removes only a leading retrieval notice and never chops an answer", () => {
  for (const prefix of [
    "没找到相关语音记忆，",
    "没有找到相关的语音记忆。",
    "没有检索到相关语音记忆：",
  ]) {
    assert.equal(assistantAnswerText(`${prefix}直接给重点。`), "直接给重点。");
  }
  assert.equal(
    assistantAnswerText("这句话里提到没找到相关语音记忆，但它是讨论内容。"),
    "这句话里提到没找到相关语音记忆，但它是讨论内容。",
  );
  assert.equal(assistantAnswerText("没找到相关语音记忆。"), "没找到相关语音记忆。");
  assert.equal(assistantAnswerText("目前无法确认你们的约定。"), "目前无法确认你们的约定。");
  assert.equal(assistantAnswerText(undefined), "");
  assert.equal(assistantAnswerText("重点。".repeat(1000)), "重点。".repeat(1000));
});

test("production room questions apply the prompt and cleanup while retaining room-scoped evidence", async () => {
  let selected: VoiceMemorySearchResult[] = [],
    prompt = "",
    searchedRoom = "";
  const service = new AiVoiceMemoryService(
    {} as never,
    {} as never,
    {
      questionRoomId: () => "main",
      generateJson: async (request: { prompt: string }) => {
        prompt = request.prompt;
        return {
          text: "没找到相关语音记忆，直接给重点。",
          sources: selected.length
            ? [
                { segmentId: "memory-1", startMs: 9999, quote: "七点" },
                { segmentId: "memory-999", quote: "伪造来源" },
              ]
            : [],
        };
      },
    } as never,
    {
      related: (_query: string, _limit: number, roomId: string) => {
        searchedRoom = roomId;
        return selected;
      },
    } as never,
  );
  const first = await service.askMemory({ question: "简单回答" });
  assert.equal(first.text, "直接给重点。");
  assert.deepEqual(first.sources, []);
  assert.equal(searchedRoom, "main");
  assert.equal(prompt.includes("可参考的语音片段："), false);
  selected = [candidate];
  const next = await service.askMemory({ question: "昨天几点约饭？" });
  assert.equal(next.sources.length, 1);
  assert.equal(next.sources[0].startMs, candidate.startMs);
  assert.equal(next.sources[0].recordingId, candidate.recordingId);
  assert.equal(prompt.includes("memory-1"), true);
});

test("assistant identity uses compatible client IDs and keeps the authenticated author for dedup and recall", async () => {
  const clientMessageId = gameAssistantMessageId(crypto.randomUUID());
  const assistant = { ...message, clientMessageId };
  assert.equal(isSignalEnvelope({ type: "chat_message", roomId: "main", ...assistant }), true);
  assert.equal(chatDisplayName(assistant), "游戏助手");
  assert.equal(chatDisplayName(message), "Sober");
  for (const id of [
    "game-assistant:invalid",
    "prefix-game-assistant:00000000-0000-0000-0000-000000000000",
    "",
    undefined,
  ])
    assert.equal(isGameAssistantMessage({ clientMessageId: id }), false);
  const history = await RelayHistory.create();
  history.append("main", assistant);
  assert.equal(history.get("side").length, 0);
  const saved = history.findByClientMessageId("main", message.senderProfileId!, clientMessageId)!;
  assert.equal(chatDisplayName(saved), "游戏助手");
  assert.equal(saved.peerId, message.peerId);
  assert.equal(history.remove("main", saved.id, "other-peer"), false);
  assert.equal(history.remove("main", saved.id, message.peerId), true);
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-assistant-history-"));
  try {
    const file = path.join(directory, "relay-history.json");
    const relay = await RelayHistory.create(file);
    relay.append("main", assistant);
    await relay.flush();
    const restoredRelay = await RelayHistory.create(file);
    const restored = restoredRelay.get("main")[0]!;
    assert.equal(chatDisplayName(restored), "游戏助手");
    assert.equal(restored.senderProfileId, message.senderProfileId);
    assert.equal(restoredRelay.get("side").length, 0);
    const local = new LocalHistory(directory);
    await local.save("relay|main", [{ ...assistant, isLocal: true }]);
    const restoredLocal = new LocalHistory(directory);
    assert.equal(chatDisplayName((await restoredLocal.read("relay|main"))[0]!), "游戏助手");
    assert.equal((await restoredLocal.read("relay|side")).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const shareHook = (
  onSend: (text: string, id: string) => Promise<void>,
  getRoom: () => { roomId: string; connectionState: RoomConnectionState },
) => {
  const source = readFileSync(
    path.resolve("src/renderer/src/features/room/useRoomAiShare.ts"),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const imports: Record<string, unknown> = {
    react: {
      useRef: (value: unknown) => ({ current: value }),
      useState: (value: unknown) => [value, () => undefined],
    },
    "@private-voice/shared": { RoomConnectionState },
    "../../store/roomStore": { useRoomStore: { getState: () => ({ room: getRoom() }) } },
    "../audio/uiSound": { playUiSound: () => undefined },
    "../chat/gameAssistantMessage": { gameAssistantMessageId },
  };
  const exports: Record<string, unknown> = {};
  new Function("require", "exports", js)((id: string) => {
    assert.ok(id in imports);
    return imports[id];
  }, exports);
  return (
    exports.useRoomAiShare as (send: typeof onSend) => { share: (text: string) => Promise<void> }
  )(onSend);
};

test("production share preserves assistant IDs through chunking and partial-failure retries", async () => {
  const attempted: Array<{ text: string; id: string }> = [];
  let fail = true;
  const sharing = shareHook(
    async (text, id) => {
      attempted.push({ text, id });
      if (attempted.length === 2 && fail) {
        fail = false;
        throw new Error("offline");
      }
    },
    () => ({ roomId: "main", connectionState: RoomConnectionState.Connected }),
  );
  const text = "🙂".repeat(600);
  await sharing.share(text);
  await sharing.share(text);
  assert.equal(attempted.length, 4);
  assert.equal(attempted[1].id, attempted[2].id);
  for (const item of attempted) {
    assert.equal(isGameAssistantMessage({ clientMessageId: item.id }), true);
    assert.equal(item.text.length <= 500, true);
    assert.equal(item.text.endsWith("🙂"), true);
  }
  assert.equal([attempted[0].text, attempted[2].text, attempted[3].text].join(""), text);
  await sharing.share(text);
  assert.equal(attempted.length, 4);
});

test("production share stops before another chunk when the room changes", async () => {
  let roomId = "main",
    sent = 0;
  const sharing = shareHook(
    async () => {
      sent++;
      roomId = "side";
    },
    () => ({ roomId, connectionState: RoomConnectionState.Connected }),
  );
  await sharing.share("字".repeat(1000));
  assert.equal(sent, 1);
});
