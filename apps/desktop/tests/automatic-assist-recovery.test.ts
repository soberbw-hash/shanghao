import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import {
  automaticCloudAssistModel,
  automaticCloudAssistRetryState,
  deferredVoiceMemoryRequest,
  needsAutomaticCloudAssist,
  needsAutomaticPostprocessing,
} from "../src/main/automatic-voice-memory-request";
import { RECORDING_ORGANIZATION_PIPELINE_VERSION } from "../src/main/recording-organizer";
import {
  retryDeferredRecordings,
  withCurrentDeferredRecording,
  automaticFusionFailure,
  recoverAutomaticOrganization,
} from "../src/main/automatic-recording-recovery";
import { queueUntranscribedRecordings } from "../src/main/automatic-recording-backlog";
import type { AiModelManager } from "../src/main/ai-model-manager";
import type { VoiceMemoryRecord } from "@private-voice/shared";

const model = { id: "qwen3-asr-0.6b-force" as const, ready: true };

test("login-expired text work remains recoverable without discarding finished summaries", () => {
  const record = {
    ...cloud(),
    summary: [{ text: "已经保存的摘要" }],
    organizedAt: new Date().toISOString(),
    organizationSinglePassRetry: {
      status: "failed",
      attempts: 3,
      errorMessage: "account_session_expired",
    },
    transcriptionFusion: { status: "failed", errorCode: "account_session_expired" },
  } as unknown as VoiceMemoryRecord;
  assert.equal(automaticFusionFailure(record), "account_session_expired");
  assert.equal(needsAutomaticPostprocessing(record, true), true);
  assert.equal(
    recoverAutomaticOrganization(record, "account_session_expired", true)
      .organizationSinglePassRetry?.attempts,
    0,
  );
  assert.deepEqual(recoverAutomaticOrganization(record, "account_session_expired", false), {});
  assert.equal(record.summary[0]?.text, "已经保存的摘要");
  assert.equal(record.organizationSinglePassRetry?.attempts, 3);
});
const cloud = () => ({
  ...createEmptyVoiceMemoryRecord({ recordingId: "resource-wait", filePath: "fixture.wav" }),
  phase: "ready" as const,
  taskStatus: "success" as const,
  autoOrganizeRequested: true,
  transcriptionModel: { id: "siliconflow-sensevoice-small" as const, name: "cloud" },
  transcriptionElapsedMs: 100,
  transcript: [
    {
      id: "cloud",
      recordingId: "resource-wait",
      text: "已有的云端原稿。",
      speakerId: "one",
      startMs: 0,
      endMs: 1000,
    },
  ],
  transcriptionAssist: {
    status: "failed" as const,
    cloudModelId: "siliconflow-sensevoice-small" as const,
    localModelId: model.id,
    errorCode: "recording_priority",
  },
});

test("resource interruption is eligible after pressure clears, permanent failures and explicit pauses are not", () => {
  const record = cloud();
  assert.equal(needsAutomaticCloudAssist(record, model), true);
  assert.equal(automaticCloudAssistRetryState(record, { ...model, ready: false }), "waiting");
  for (const reason of [
    "hybrid_local_incomplete",
    "model_missing",
    "invalid_audio",
    "ai_task_paused",
  ])
    assert.equal(
      needsAutomaticCloudAssist(
        { ...record, transcriptionAssist: { ...record.transcriptionAssist, errorCode: reason } },
        model,
      ),
      false,
    );
  assert.equal(needsAutomaticCloudAssist({ ...record, phase: "paused" }, model), false);
  assert.equal(automaticCloudAssistRetryState(record, undefined), undefined);
  const request = deferredVoiceMemoryRequest(record, true, model);
  assert.equal(request.transcribe, true);
  assert.equal(request.organize, true);
  assert.notEqual(request.restartTranscription, true);
});

test("the model admission gate respects current pressure, disabled assist and explicit model removal", () => {
  let runnable = false,
    removed = false;
  const models = {
    getSnapshot: () => ({
      models: [
        { id: model.id, activeRevision: "installed", runtimeReady: true, userInstalled: !removed },
      ],
    }),
    canRunTask: () => ({ runnable }),
  } as unknown as AiModelManager;
  assert.equal(automaticCloudAssistModel(models, true, model.id)?.ready, false);
  runnable = true;
  assert.equal(automaticCloudAssistModel(models, true, model.id)?.ready, true);
  assert.equal(automaticCloudAssistModel(models, false, model.id), undefined);
  removed = true;
  assert.equal(automaticCloudAssistModel(models, true, model.id), undefined);
});

test("a waiting local correction schedules a later check and admits only one correction per round", async () => {
  const records = [cloud(), { ...cloud(), recordingId: "second" }];
  let started = 0,
    scheduled = 0,
    ready = false;
  const state = (record: (typeof records)[number]) =>
    automaticCloudAssistRetryState(record, { ...model, ready });
  const run = () =>
    retryDeferredRecordings(
      true,
      false,
      false,
      async () => records,
      async () => {
        started++;
      },
      () => {
        scheduled++;
      },
      state,
    );
  await run();
  assert.equal(started, 0);
  assert.ok(scheduled > 0);
  ready = true;
  await run();
  assert.equal(started, 1);
  await retryDeferredRecordings(
    false,
    false,
    false,
    async () => records,
    async () => {
      started++;
    },
    () => {},
    state,
  );
  assert.equal(started, 1);
});

test("last-moment pause or revision replacement defeats a scanned assistance retry", async () => {
  const record = cloud();
  let started = 0;
  const dispatch = (current: typeof record) =>
    withCurrentDeferredRecording(
      record,
      async () => current,
      () => true,
      async () => {
        started++;
      },
      (value) => needsAutomaticCloudAssist(value, model),
    );
  await dispatch({ ...record, updatedAt: "changed" });
  await withCurrentDeferredRecording(
    record,
    async () => ({ ...record, phase: "paused" }),
    () => true,
    async () => {
      started++;
    },
    (value) => needsAutomaticCloudAssist(value, model),
  );
  assert.equal(started, 0);
  await dispatch(record);
  assert.equal(started, 1);
});

test("backfilling local timing cannot turn an explicitly declined text upload back on", async () => {
  const record = { ...cloud(), autoOrganizeRequested: false };
  await queueUntranscribedRecordings([record], true, {
    enabled: () => true,
    get: async () => record,
    pending: () => false,
    reconcile: async () => {},
    assistModel: () => model,
    start: async (request) => {
      assert.equal(request.transcribe, true);
      assert.equal(request.organize, false);
    },
  });
  assert.equal(record.transcriptionAssist.errorCode, "recording_priority");
});

test("an opted-in old summary refreshes through text only, keeping previous text and respecting pauses", () => {
  const record = {
    ...cloud(),
    organizedAt: new Date().toISOString(),
    summary: [{ text: "旧摘要仍保留" }],
    organization: {
      status: "completed",
      pipelineVersion: RECORDING_ORGANIZATION_PIPELINE_VERSION - 1,
    },
  } as unknown as ReturnType<typeof cloud>;
  assert.equal(needsAutomaticPostprocessing(record, true), true);
  assert.equal(deferredVoiceMemoryRequest(record, true).transcribe, false);
  assert.equal(record.summary[0]?.text, "旧摘要仍保留");
  assert.equal(needsAutomaticPostprocessing({ ...record, phase: "paused" }, true), false);
  assert.equal(
    needsAutomaticPostprocessing({ ...record, autoOrganizeRequested: false }, true),
    false,
  );
  assert.equal(needsAutomaticPostprocessing(record, false), false);
  assert.equal(
    needsAutomaticPostprocessing(
      {
        ...record,
        organization: {
          ...record.organization!,
          pipelineVersion: RECORDING_ORGANIZATION_PIPELINE_VERSION,
        },
      },
      true,
    ),
    false,
  );
});
