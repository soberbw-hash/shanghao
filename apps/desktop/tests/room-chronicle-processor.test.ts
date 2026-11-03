import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { RoomChronicleProcessor } from "../../../packages/signaling/src/room-chronicle-processor";
import { RoomChronicleSessions } from "../../../packages/signaling/src/room-chronicle-sessions";
import {
  isSignalEnvelope,
  type ChronicleAudioMessage,
} from "../../../packages/signaling/src/protocol";

const part = (sessionId: string, peerId = "a", chunkId = "one"): ChronicleAudioMessage => ({
  type: "chronicle_audio",
  roomId: "main",
  peerId,
  sessionId,
  chunkId,
  startedAt: Date.now() - 30_000,
  durationMs: 30_000,
  mime: "audio/webm",
  data: "YXVkaW8=",
});
const setup = () => {
  const sessions = new RoomChronicleSessions();
  const id = sessions.start("main", "a", ["a", "b"]);
  sessions.participate("main", id, "a", true);
  sessions.participate("main", id, "b", true);
  return { sessions, id };
};

async function until(predicate: () => boolean, timeout = 2000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < end, "expected asynchronous chronicle update");
    await delay(5);
  }
}

test("independent member chunks form one bounded shared summary and deduplicate retries", async () => {
  const { sessions, id } = setup();
  let calls = 0;
  let prompt = "";
  const processor = new RoomChronicleProcessor(
    sessions,
    {
      isConfigured: () => true,
      transcribe: async () => {
        calls++;
        return { text: "只是一段合成对话", modelName: "fixture" };
      },
    },
    {
      isConfigured: () => true,
      execute: async (request) => {
        prompt = request.prompt;
        return '{"text":"甲说自己稳如老狗，乙提醒他刚送了一波。"}';
      },
    },
    () => undefined,
    5,
  );
  try {
    await Promise.all([processor.submit(part(id), "甲"), processor.submit(part(id, "b"), "乙")]);
    await processor.submit(part(id), "不能重复");
    await until(() => sessions.read("main", id, "a").length === 1);
    assert.equal(calls, 2);
    assert.match(prompt, /"name":"甲"/);
    assert.match(prompt, /"name":"乙"/);
    assert.doesNotMatch(prompt, /不能重复/);
    assert.deepEqual(sessions.read("main", id, "a"), sessions.read("main", id, "b"));
  } finally {
    processor.dispose();
  }
});

test("withdrawing consent aborts processing and rejects late results even when the provider ignores abort", async () => {
  const { sessions, id } = setup();
  let finish!: (value: { text: string; modelName: string }) => void;
  let providerSignal: AbortSignal | undefined;
  let textCalls = 0;
  const processor = new RoomChronicleProcessor(
    sessions,
    {
      isConfigured: () => true,
      transcribe: (_audio, _mime, signal) => {
        providerSignal = signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
    {
      isConfigured: () => true,
      execute: async () => {
        textCalls++;
        return '{"text":"不应出现"}';
      },
    },
    () => undefined,
    1,
  );
  try {
    const pending = processor.submit(part(id), "甲");
    sessions.participate("main", id, "a", false);
    processor.cancelRoom("main");
    assert.equal(providerSignal?.aborted, true);
    finish({ text: "撤回的录音", modelName: "fixture" });
    await assert.rejects(pending);
    await delay(10);
    assert.equal(textCalls, 0);
    assert.deepEqual(sessions.read("main", id, "b"), []);
  } finally {
    processor.dispose();
  }
});

test("summary service failure retries itself and retains already accepted text", async () => {
  const { sessions, id } = setup();
  let calls = 0;
  const processor = new RoomChronicleProcessor(
    sessions,
    {
      isConfigured: () => true,
      transcribe: async () => ({ text: "合成语音", modelName: "fixture" }),
    },
    {
      isConfigured: () => true,
      execute: async () => {
        if (++calls === 1) throw Error("cloud_ai_busy");
        return '{"text":"恢复后的纪事"}';
      },
    },
    () => undefined,
    1,
  );
  try {
    await processor.submit(part(id), "甲");
    await until(() => sessions.snapshot("main", "a")?.notice === "retrying");
    await until(() => sessions.read("main", id, "a").length === 1);
    assert.equal(calls, 2);
    assert.equal(sessions.snapshot("main", "a")?.notice, undefined);
  } finally {
    processor.dispose();
  }
});

test("a late summary after timeout is discarded and the same text is retried", async (t) => {
  const { sessions, id } = setup();
  const timeout = new AbortController();
  let timeouts = 0,
    calls = 0;
  let finish!: (value: string) => void;
  t.mock.method(AbortSignal, "timeout", () =>
    ++timeouts === 2 ? timeout.signal : new AbortController().signal,
  );
  const processor = new RoomChronicleProcessor(
    sessions,
    {
      isConfigured: () => true,
      transcribe: async () => ({ text: "合成语音", modelName: "fixture" }),
    },
    {
      isConfigured: () => true,
      execute: async () => {
        if (++calls === 1)
          return new Promise<string>((resolve) => {
            finish = resolve;
          });
        return '{"text":"重试完成的纪事"}';
      },
    },
    () => undefined,
    1,
  );
  try {
    await processor.submit(part(id), "甲");
    await until(() => !!finish);
    timeout.abort();
    finish('{"text":"已超时的旧纪事"}');
    await until(() => sessions.snapshot("main", "a")?.notice === "retrying");
    assert.deepEqual(sessions.read("main", id, "a"), []);
    await until(() => sessions.read("main", id, "a").length === 1);
    assert.equal(sessions.read("main", id, "a")[0]?.text, "重试完成的纪事");
    assert.equal(calls, 2);
  } finally {
    processor.dispose();
  }
});

test("chronicle protocol rejects oversized and malformed audio before recognition", () => {
  assert.equal(isSignalEnvelope(part("synthetic")), true);
  assert.equal(isSignalEnvelope({ ...part("synthetic"), data: "=bad" }), false);
  assert.equal(isSignalEnvelope({ ...part("synthetic"), data: "A".repeat(220004) }), false);
  assert.equal(isSignalEnvelope({ ...part("synthetic"), durationMs: 60000 }), false);
  assert.equal(isSignalEnvelope({ ...part("synthetic"), startedAt: -1 }), false);
});

test("summary follows capture chronology when independent recognitions finish out of order", async () => {
  const { sessions, id } = setup();
  let finishEarly!: (result: { text: string; modelName: string }) => void;
  let prompt = "";
  const processor = new RoomChronicleProcessor(
    sessions,
    {
      isConfigured: () => true,
      transcribe: (audio) =>
        audio.toString() === "early"
          ? new Promise((resolve) => {
              finishEarly = resolve;
            })
          : Promise.resolve({ text: "后来的回应", modelName: "fixture" }),
    },
    {
      isConfigured: () => true,
      execute: async (request) => {
        prompt = request.prompt;
        return '{"text":"先有人立下豪言，随后被队友拆台。"}';
      },
    },
    () => undefined,
    15,
  );
  try {
    const at = Date.now() - 60_000;
    const early = processor.submit(
      { ...part(id), startedAt: at, data: Buffer.from("early").toString("base64") },
      "甲",
    );
    await processor.submit({ ...part(id, "b"), startedAt: at + 30_000 }, "乙");
    finishEarly({ text: "先前的豪言", modelName: "fixture" });
    await early;
    await until(() => sessions.read("main", id, "a").length === 1);
    assert.ok(prompt.indexOf("先前的豪言") < prompt.indexOf("后来的回应"));
    assert.equal(sessions.read("main", id, "a")[0]?.at, at);
  } finally {
    processor.dispose();
  }
});

test("expired buffered text is discarded before calling the summary provider after a long suspension", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const { sessions, id } = setup();
  let textCalls = 0;
  const processor = new RoomChronicleProcessor(
    sessions,
    {
      isConfigured: () => true,
      transcribe: async () => ({ text: "会过期的合成内容", modelName: "fixture" }),
    },
    {
      isConfigured: () => true,
      execute: async () => {
        textCalls++;
        return '{"text":"不应生成"}';
      },
    },
    () => undefined,
    10,
  );
  try {
    await processor.submit(part(id), "甲");
    t.mock.timers.tick(300_001);
    await delay(40);
    assert.equal(textCalls, 0);
    assert.equal(sessions.snapshot("main", "a")?.notice, "unavailable");
    assert.deepEqual(sessions.read("main", id, "a"), []);
  } finally {
    processor.dispose();
    t.mock.timers.reset();
  }
});

test("simultaneous chunks are bounded and canceled summary work cannot publish after a room ends", async () => {
  const { sessions, id } = setup();
  const finish: Array<(result: { text: string; modelName: string }) => void> = [];
  const processor = new RoomChronicleProcessor(
    sessions,
    {
      isConfigured: () => true,
      transcribe: () =>
        new Promise((resolve) => {
          finish.push(resolve);
        }),
    },
    { isConfigured: () => true, execute: async () => '{"text":"不应出现"}' },
    () => undefined,
    1,
  );
  try {
    const first = processor.submit(part(id), "甲");
    const second = processor.submit(part(id, "b"), "乙");
    await assert.rejects(processor.submit(part(id, "a", "two"), "甲"), /busy/);
    assert.equal(finish.length, 2);
    sessions.stop("main", id, "a");
    processor.cancelRoom("main");
    finish.forEach((resolve) => resolve({ text: "迟到资料", modelName: "fixture" }));
    await Promise.all([assert.rejects(first), assert.rejects(second)]);
    const next = sessions.start("main", "a", ["a"]);
    await delay(10);
    assert.deepEqual(sessions.read("main", next, "a"), []);
  } finally {
    processor.dispose();
  }
});
