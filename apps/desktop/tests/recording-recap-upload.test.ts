import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { VoiceMemoryRecord, VoiceMemoryOrganizationPublication } from "@private-voice/shared";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { createRecordingRecapUpload } from "../src/main/recording-recap-upload";
import { publishVoiceMemoryOrganization } from "../src/main/recording-recap-publisher";
import { markVoiceMemoryPublication } from "../src/main/voice-memory-publication";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";
import { handleRecordingRecap } from "../../../packages/signaling/src/recording-recap-handler";
import type { SignalingClientBridge } from "../src/main/signaling-client";

type RecapRequest = Parameters<SignalingClientBridge["publishRecordingRecap"]>[0];

const roomA = `room_${"a".repeat(32)}`,
  roomB = `room_${"b".repeat(32)}`;
const ready = (): VoiceMemoryRecord => ({
  ...createEmptyVoiceMemoryRecord({
    recordingId: "fixture",
    filePath: "private.m4a",
    roomId: roomA,
    recordedAt: "2026-10-01T17:00:00.000Z",
  }),
  phase: "ready",
  organizedAt: "2026-10-04T04:00:00.000Z",
  transcript: [
    {
      id: "s1",
      recordingId: "fixture",
      startMs: 0,
      endMs: 5000,
      speakerId: "one",
      text: "周六一起吃饭，等打完游戏再出发。",
      confidence: "high",
    },
  ],
  organization: {
    pipelineVersion: 1,
    modelId: "cloud",
    modelRevision: "remote-v1",
    status: "completed",
    completedChunks: 1,
    chunks: [],
    startedAt: "2026-10-04",
    updatedAt: "2026-10-04",
    finalResult: {
      description: "打完游戏后一起吃饭。",
      summary: [{ text: "周六一起吃饭。" }],
      topics: [],
      timeline: [],
      highlights: [],
      funnyMoments: [],
      importantInformation: [],
      participants: [],
      keywords: ["约饭"],
    },
  },
});
const fixture = () => {
  let record = ready(),
    calls = 0,
    sent: RecapRequest | undefined;
  const voiceMemory = {
    get: async () => record,
    markOrganizationPublished: async (
      _id: string,
      publication: VoiceMemoryOrganizationPublication,
      time?: string,
    ) =>
      markVoiceMemoryPublication(
        "fixture",
        publication,
        time,
        async () => record,
        async (next) => (record = next),
      ),
  };
  const signalingClient = {
    publishRecordingRecap: async (request: RecapRequest) => {
      calls++;
      sent = request;
      return {
        roomId: request.roomId,
        reportDate: request.reportDate,
        publishedAt: "2026-10-04",
        serverRevision: 1,
      };
    },
  };
  return {
    voiceMemory,
    signalingClient,
    get record() {
      return record;
    },
    set record(value) {
      record = value;
    },
    get calls() {
      return calls;
    },
    get sent() {
      return sent;
    },
  };
};

test("manual upload sends summary only to original room and original Shanghai date", async () => {
  const f = fixture();
  await publishVoiceMemoryOrganization({ ...f, recordingId: "fixture" });
  assert.ok(f.sent);
  assert.equal(f.sent.roomId, roomA);
  assert.equal(f.sent.reportDate, "2026-10-02");
  assert.equal("transcript" in f.sent.recap, false);
  assert.equal(JSON.stringify(f.sent).includes("private.m4a"), false);
  assert.equal(f.record.organizationPublication?.status, "published");
  await publishVoiceMemoryOrganization({ ...f, recordingId: "fixture" });
  assert.equal(f.calls, 1);
});

test("automatic upload is opt-in and deduplicates automatic/manual clicks", async () => {
  const f = fixture();
  let enabled = false;
  const upload = createRecordingRecapUpload(f, () => ({ isAiAutoUploadEnabled: enabled }));
  upload.onCompleted(f.record);
  await Promise.resolve();
  assert.equal(f.calls, 0);
  enabled = true;
  upload.onCompleted({ ...f.record, phase: "organizing" });
  upload.onCompleted({ ...f.record, taskId: "model-comparison:fixture" });
  await Promise.resolve();
  assert.equal(f.calls, 0);
  upload.onCompleted(f.record);
  upload.onCompleted(f.record);
  await upload.upload("fixture");
  assert.equal(f.calls, 1);
  upload.onCompleted(f.record);
  await Promise.resolve();
  assert.equal(f.calls, 1);
});

test("turning off automatic upload before dispatch cancels admission", async () => {
  const f = fixture();
  let enabled = true;
  const upload = createRecordingRecapUpload(f, () => ({ isAiAutoUploadEnabled: enabled }));
  upload.onCompleted(f.record);
  enabled = false;
  await upload.upload("fixture");
  assert.equal(f.calls, 0);
});

test("wrong joined room and wrong-room acknowledgments preserve local results and allow retry", async () => {
  const f = fixture();
  f.signalingClient.publishRecordingRecap = async () => {
    throw new Error("recording_recap_join_matching_room");
  };
  await publishVoiceMemoryOrganization({ ...f, recordingId: "fixture", automatic: true });
  assert.equal(f.record.organizationPublication?.status, "failed");
  assert.equal(f.record.organization?.status, "completed");
  f.signalingClient.publishRecordingRecap = async () => ({
    roomId: roomB,
    reportDate: "2026-10-02",
    publishedAt: "now",
    serverRevision: 1,
  });
  await assert.rejects(
    publishVoiceMemoryOrganization({ ...f, recordingId: "fixture" }),
    /response_mismatch/,
  );
  assert.equal(f.record.organizationPublication?.status, "failed");
});

test("upload requires completed organization and a confirmed room", async () => {
  const f = fixture();
  f.record = { ...f.record, organization: undefined };
  await assert.rejects(
    publishVoiceMemoryOrganization({ ...f, recordingId: "fixture" }),
    /organization_required/,
  );
  f.record = { ...ready(), roomId: undefined };
  await assert.rejects(
    publishVoiceMemoryOrganization({ ...f, recordingId: "fixture" }),
    /room_invalid/,
  );
  assert.equal(f.calls, 0);
});

test("publication commits preserve newer metadata and reject replaced results atomically", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-upload-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new VoiceMemoryStore(root);
  await store.initialize();
  const old = ready();
  await store.save(old);
  await store.save({ ...old, filePath: "renamed.m4a" });
  const publication = {
    status: "published" as const,
    roomId: roomA,
    reportDate: "2026-10-02",
    publishedAt: "now",
  };
  const saved = await store.save(
    { ...old, organizationPublication: publication },
    { publicationFor: { roomId: roomA, organizedAt: old.organizedAt } },
  );
  assert.equal(saved.filePath, "renamed.m4a");
  await store.save({ ...saved, organizedAt: "next-result", organizationPublication: undefined });
  await assert.rejects(
    store.save(
      { ...old, organizationPublication: publication },
      { publicationFor: { roomId: roomA, organizedAt: old.organizedAt } },
    ),
    /result_changed/,
  );
  assert.equal((await store.get(old.recordingId))?.organizationPublication, undefined);
});

test("room question retrieval excludes all other rooms", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-memory-room-fixture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new VoiceMemoryStore(root);
  await store.initialize();
  await store.save(ready());
  await store.save({ ...ready(), recordingId: "other", roomId: roomB });
  assert.ok(store.related("一起吃饭", 24, roomA).length);
  assert.ok(store.related("一起吃饭", 24, roomA).every((item) => item.recordingId === "fixture"));
});

test("server acknowledges only after storage completes and never on storage failure", async () => {
  let release!: () => void,
    sent = 0,
    code = "";
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = {
    publishRecordingRecap: () => ({ publishedAt: "now", serverRevision: 1 }),
    flushWrites: () => waiting,
  };
  const message = {
    type: "publish_recording_recap",
    roomId: roomA,
    peerId: "peer",
    requestId: "request",
    reportDate: "2026-10-02",
    recap: {},
  } as never;
  const work = handleRecordingRecap(
    store as never,
    message,
    () => sent++,
    (value) => {
      code = value;
    },
  );
  await Promise.resolve();
  assert.equal(sent, 0);
  release();
  await work;
  assert.equal(sent, 1);
  store.flushWrites = async () => {
    throw new Error("disk failure");
  };
  await handleRecordingRecap(
    store as never,
    message,
    () => sent++,
    (value) => {
      code = value;
    },
  );
  assert.equal(sent, 1);
  assert.equal(code, "recording_recap_storage_failed");
});
