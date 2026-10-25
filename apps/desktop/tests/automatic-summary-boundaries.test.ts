import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { VoiceMemoryRecord, VoiceMemoryProcessRequest } from "@private-voice/shared";
import { AiVoiceMemoryService } from "../src/main/ai-voice-memory-service";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { RecordingOverview } from "../src/renderer/src/components/settings/RecordingOverview";

const ready = (): VoiceMemoryRecord => ({
  ...createEmptyVoiceMemoryRecord({ recordingId: "fixture", filePath: "synthetic.wav" }),
  phase: "ready",
  taskStatus: "success",
  taskId: "fixture-task",
  transcriptionModel: { id: "siliconflow-sensevoice-small", name: "synthetic" },
  transcriptionElapsedMs: 100,
  transcript: [
    {
      id: "one",
      recordingId: "fixture",
      speakerId: "synthetic",
      startMs: 0,
      endMs: 2000,
      text: "这是用于测试的合成文字。",
    },
  ],
});

test("a legacy ready transcript exposes summary recovery instead of an endless preparing state", () => {
  const html = renderToStaticMarkup(
    createElement(RecordingOverview, { record: ready(), busy: false, onRetry() {}, onSeek() {} }),
  );
  assert.match(html, /补生成摘要/);
  assert.match(html, /还没有摘要/);
  assert.doesNotMatch(html, /正在准备录音摘要/);
});

test("a saved legacy summary remains readable without new organization checkpoints", () => {
  const record = ready();
  record.organizedAt = record.updatedAt;
  record.summary = [{ text: "已经保存的历史摘要", sourceStartMs: 0 }];
  const html = renderToStaticMarkup(
    createElement(RecordingOverview, { record, busy: false, onRetry() {}, onSeek() {} }),
  );
  assert.match(html, /已经保存的历史摘要/);
  assert.doesNotMatch(html, /正在准备录音摘要|补生成摘要/);
});

test("an old completion date without any saved summary offers recovery", () => {
  const record = ready();
  record.organizedAt = record.updatedAt;
  const html = renderToStaticMarkup(
    createElement(RecordingOverview, { record, busy: false, onRetry() {}, onSeek() {} }),
  );
  assert.match(html, /补生成摘要/);
  assert.doesNotMatch(html, /正在准备录音摘要/);
});

for (const kind of ["paused", "partial", "replaced", "disabled", "complete"] as const) {
  test(`automatic postprocessing boundary: ${kind}`, async () => {
    const result = ready();
    if (kind === "paused") result.phase = "paused";
    if (kind === "partial") {
      result.taskStatus = "failed";
      result.errorMessage = "partial_transcription";
    }
    const calls: VoiceMemoryProcessRequest[] = [];
    const service = Object.create(AiVoiceMemoryService.prototype) as AiVoiceMemoryService;
    Object.assign(service, {
      store: {
        get: async () => (kind === "replaced" ? { ...result, taskId: "new-task" } : result),
      },
      isAutomaticTranscriptionEnabled: () => kind !== "disabled",
      process: async (request: VoiceMemoryProcessRequest) => {
        calls.push(request);
        return result;
      },
    });
    (
      service as unknown as {
        queueAutomaticProcess(request: VoiceMemoryProcessRequest, historical: boolean): void;
      }
    ).queueAutomaticProcess(
      {
        recordingId: "fixture",
        filePath: "synthetic.wav",
        taskId: "fixture-task",
        organize: true,
      },
      true,
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, kind === "complete" ? 2 : 1);
    if (kind === "complete") assert.equal(calls[1]?.transcribe, false);
  });
}
