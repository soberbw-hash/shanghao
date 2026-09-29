import assert from "node:assert/strict";
import test from "node:test";

import type { AiRuntimePressure } from "@private-voice/shared";

import {
  GAMING_DOWNLOAD_BYTES_PER_SECOND,
  NORMAL_DOWNLOAD_BYTES_PER_SECOND,
  REALTIME_PRESSURE_DOWNLOAD_BYTES_PER_SECOND,
  RESOURCE_PRIORITY,
  ResourceScheduler,
} from "../src/main/resource-scheduler";

test("denial telemetry is bounded memory-only and does not alter decisions", () => {
  const scheduler = new ResourceScheduler();
  for (let i = 0; i < 10000; i++)
    assert.equal(scheduler.aiDecision("summary", false).reason, "manual_only");
  assert.equal(scheduler.getDenialSnapshot().total, 10000);
  assert.equal(scheduler.getDenialSnapshot().byReason.manual_only, 10000);
  scheduler.aiDecision("summary", true);
  assert.equal(scheduler.getDenialSnapshot().total, 10000);
  scheduler.update({ processingMode: "after_game", gameActive: true });
  scheduler.aiDecision("summary", false);
  assert.equal(scheduler.getDenialSnapshot().lastReason, "waiting_for_game_to_finish");
  const snapshot = scheduler.getDenialSnapshot();
  snapshot.byReason.manual_only = 0;
  assert.equal(scheduler.getDenialSnapshot().byReason.manual_only, 10000);
});

const pressure = (overrides: Partial<AiRuntimePressure>): AiRuntimePressure => ({
  inVoiceRoom: false,
  screenSharing: false,
  peerRecovering: false,
  latencyMs: 0,
  packetLossPercent: 0,
  rendererMemoryPressure: false,
  updatedAt: Date.now(),
  ...overrides,
});

test("resource priority keeps realtime room work ahead of AI and downloads", () => {
  assert.ok(RESOURCE_PRIORITY.realtimeVoice > RESOURCE_PRIORITY.peerRecovery);
  assert.ok(RESOURCE_PRIORITY.peerRecovery > RESOURCE_PRIORITY.screenShare);
  assert.ok(RESOURCE_PRIORITY.recording > RESOURCE_PRIORITY.aiInference);
  assert.ok(RESOURCE_PRIORITY.aiOrganization > RESOURCE_PRIORITY.backgroundDownload);
});

test("resource scheduler throttles and yields background work during realtime pressure", () => {
  const scheduler = new ResourceScheduler();
  assert.equal(scheduler.downloadBytesPerSecond(), NORMAL_DOWNLOAD_BYTES_PER_SECOND);
  scheduler.update({ gameActive: true });
  assert.equal(scheduler.downloadBytesPerSecond(), GAMING_DOWNLOAD_BYTES_PER_SECOND);
  scheduler.update({
    gameActive: false,
    pressure: pressure({ inVoiceRoom: true, screenSharing: true }),
  });
  assert.equal(scheduler.downloadBytesPerSecond(), REALTIME_PRESSURE_DOWNLOAD_BYTES_PER_SECOND);
  assert.equal(scheduler.aiDecision("summary", false).resourceMode, "low");
  scheduler.update({ realtimePressureHigh: true, pressureReason: "peer_recovery" });
  assert.deepEqual(scheduler.aiDecision("transcription", false), {
    runnable: false,
    reason: "peer_recovery",
    resourceMode: "low",
  });
  assert.equal(scheduler.aiDecision("transcription", true).runnable, true);
  assert.deepEqual(scheduler.shouldReleaseQwen(), { release: true, reason: "peer_recovery" });
});

test("recording protects the capture path from automatic AI while manual work stays low resource", () => {
  const scheduler = new ResourceScheduler();
  scheduler.update({ processingMode: "immediate", pressure: pressure({ recordingActive: true }) });
  assert.deepEqual(scheduler.aiDecision("transcription", false), {
    runnable: false,
    reason: "recording_priority",
    resourceMode: "low",
  });
  assert.deepEqual(scheduler.aiDecision("transcription", true), {
    runnable: true,
    resourceMode: "low",
  });
  assert.equal(scheduler.getDenialSnapshot().byReason.recording_priority, 1);
  scheduler.update({ pressure: pressure({ recordingActive: false }) });
  assert.deepEqual(scheduler.aiDecision("transcription", false), {
    runnable: true,
    resourceMode: "normal",
  });
});

test("AI compute admission is exclusive and prioritizes manual work over background work", async () => {
  const scheduler = new ResourceScheduler();
  scheduler.update({ processingMode: "immediate" });
  const first = await scheduler.acquireCompute("transcription", false);
  const order: string[] = [];
  const backgroundSummary = scheduler.acquireCompute("summary", false).then((lease) => {
    order.push("background-summary");
    lease.release();
  });
  const backgroundAsr = scheduler.acquireCompute("transcription", false).then((lease) => {
    order.push("background-asr");
    lease.release();
  });
  const manual = scheduler.acquireCompute("summary", true).then((lease) => {
    order.push("manual");
    lease.release();
  });
  assert.deepEqual(scheduler.getComputeSnapshot(), {
    activeKind: "transcription",
    activePhase: "running",
    stoppingReason: undefined,
    waiting: 3,
  });
  first.release();
  await Promise.all([backgroundSummary, backgroundAsr, manual]);
  assert.deepEqual(order, ["manual", "background-asr", "background-summary"]);
  assert.deepEqual(scheduler.getComputeSnapshot(), {
    activeKind: undefined,
    activePhase: undefined,
    stoppingReason: undefined,
    waiting: 0,
  });
  first.release();
  assert.equal(scheduler.getComputeSnapshot().activeKind, undefined);
});

test("waiting AI work is cancellable and rechecks realtime pressure before running", async () => {
  const scheduler = new ResourceScheduler();
  scheduler.update({ processingMode: "immediate" });
  const first = await scheduler.acquireCompute("transcription", true);
  const controller = new AbortController();
  const cancelled = scheduler.acquireCompute("summary", true, controller.signal);
  const automatic = scheduler.acquireCompute("summary", false);
  controller.abort();
  await assert.rejects(cancelled, /ai_task_paused/);
  assert.equal(scheduler.getComputeSnapshot().waiting, 1);
  scheduler.update({ realtimePressureHigh: true, pressureReason: "peer_recovery" });
  first.release();
  await assert.rejects(automatic, /peer_recovery/);
  assert.deepEqual(scheduler.getComputeSnapshot(), {
    activeKind: undefined,
    activePhase: undefined,
    stoppingReason: undefined,
    waiting: 0,
  });
});

test("stopping compute admission rejects queued work without releasing an active task", async () => {
  const scheduler = new ResourceScheduler();
  const active = await scheduler.acquireCompute("transcription", true);
  const waiting = scheduler.acquireCompute("summary", true);
  scheduler.cancelCompute();
  await assert.rejects(waiting, /ai_task_paused/);
  assert.deepEqual(scheduler.getComputeSnapshot(), {
    activeKind: "transcription",
    activePhase: "stopping",
    stoppingReason: "cancelled",
    waiting: 0,
  });
  assert.equal(active.signal.aborted, true);
  active.release();
  assert.deepEqual(scheduler.getComputeSnapshot(), {
    activeKind: undefined,
    activePhase: undefined,
    stoppingReason: undefined,
    waiting: 0,
  });
});

test("running automatic AI yields when room pressure rises while manual work keeps ownership", async () => {
  const scheduler = new ResourceScheduler();
  scheduler.update({ processingMode: "immediate" });
  const automatic = await scheduler.acquireCompute("transcription", false);
  scheduler.update({ realtimePressureHigh: true, pressureReason: "peer_recovery" });
  assert.equal(automatic.signal.aborted, true);
  assert.equal(scheduler.getComputeSnapshot().activeKind, "transcription");
  assert.equal(scheduler.getComputeSnapshot().activePhase, "stopping");
  assert.equal(scheduler.getComputeSnapshot().stoppingReason, "realtime_pressure");
  const manual = scheduler.acquireCompute("summary", true);
  automatic.release();
  const granted = await manual;
  assert.equal(granted.signal.aborted, false);
  scheduler.update({ pressure: pressure({ recordingActive: true }) });
  assert.equal(granted.signal.aborted, false);
  granted.release();
  assert.equal(scheduler.getComputeSnapshot().activeKind, undefined);
});

test("Qwen pressure release waits for an active manual text job", async () => {
  const scheduler = new ResourceScheduler();
  const manual = await scheduler.acquireCompute("summary", true);
  scheduler.update({ pressure: pressure({ recordingActive: true, peerRecovering: true }) });
  assert.deepEqual(scheduler.shouldReleaseQwen(), { release: false });
  assert.equal(manual.signal.aborted, false);
  manual.release();
  assert.deepEqual(scheduler.shouldReleaseQwen(), { release: true, reason: "peer_recovery" });
});

test("AI compute timeline is bounded and contains only scheduling transitions", async () => {
  const scheduler = new ResourceScheduler();
  scheduler.update({ processingMode: "immediate" });
  const first = await scheduler.acquireCompute("transcription", false);
  const waiting = scheduler.acquireCompute("summary", true);
  scheduler.update({ pressure: pressure({ recordingActive: true }) });
  assert.equal(first.signal.aborted, true);
  first.release();
  const manual = await waiting;
  manual.release();
  const events = scheduler.getComputeTimeline();
  assert.deepEqual(
    events.map(({ phase }) => phase),
    ["started", "queued", "stopping", "released", "started", "released"],
  );
  assert.equal(events[0]?.id, events[3]?.id);
  assert.equal(events[1]?.id, events[4]?.id);
  assert.equal(events[2]?.reason, "recording_priority");
  events[0]!.reason = "mutated-copy";
  assert.equal(scheduler.getComputeTimeline()[0]?.reason, undefined);
  for (let i = 0; i < 100; i++) {
    await assert.rejects(scheduler.acquireCompute("summary", false), /recording_priority/);
  }
  assert.equal(scheduler.getComputeTimeline().length, 64);
});
