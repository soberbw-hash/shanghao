import assert from "node:assert/strict";
import test from "node:test";
import { RoomChronicleController } from "../../../packages/signaling/src/room-chronicle-controller";
import type { ChronicleStateMessage } from "../../../packages/signaling/src/protocol";

test("legacy chronicle name overrides do not replace the authenticated speaker name", async () => {
  const controller = new RoomChronicleController();
  const id = controller.sessions.start("main", "a", ["a"]);
  controller.sessions.participate("main", id, "a", true);
  const names: string[] = [];
  (
    controller as unknown as {
      processor: { submit: (message: unknown, name: string) => Promise<void> };
    }
  ).processor = {
    submit: async (_message, name) => {
      names.push(name);
    },
  };
  const part = {
    type: "chronicle_audio" as const,
    roomId: "main",
    peerId: "a",
    sessionId: id,
    chunkId: "one",
    startedAt: Date.now(),
    durationMs: 1000,
    mime: "audio/webm" as const,
    data: "YXVkaW8=",
  };
  await controller.audio({ ...part, speakerName: "小尤" }, "Sober", () => {});
  await controller.audio(part, "Sober", () => {});
  assert.deepEqual(names, ["Sober", "Sober"]);
});

test("speech quota failures remain distinguishable from a connection failure", async () => {
  const controller = new RoomChronicleController();
  controller.configure(
    {
      speechService: {
        isConfigured: () => true,
        transcribe: async () => {
          throw Error("cloud_asr_http_402");
        },
      },
      textService: { isConfigured: () => true, execute: async () => '{"text":"unused"}' },
    },
    () => undefined,
  );
  try {
    controller.handle(
      "main",
      "a",
      ["a"],
      { type: "chronicle_control", roomId: "main", peerId: "a", action: "start" },
      () => undefined,
    );
    const sessionId = controller.sessions.snapshot("main", "a")!.sessionId;
    let response: ChronicleStateMessage | undefined;
    await controller.audio(
      {
        type: "chronicle_audio",
        roomId: "main",
        peerId: "a",
        sessionId,
        chunkId: "synthetic",
        startedAt: Date.now(),
        durationMs: 1000,
        mime: "audio/webm",
        data: "YXVkaW8=",
      },
      "甲",
      (message) => {
        response = message;
      },
    );
    assert.equal(response?.error, "chronicle_speech_quota");
    assert.equal(response?.state?.summaryIntervalMs, 120000);
    assert.deepEqual(response?.state?.entries, []);
  } finally {
    controller.dispose();
  }
});
