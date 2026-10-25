import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildReadableTranscriptParagraphs, type VoiceMemoryRecord } from "@private-voice/shared";
import { transcriptSeekRuns } from "../src/renderer/src/features/ai/transcriptSeek";
import {
  transcriptViewOptions,
  resolveTranscriptView,
} from "../src/renderer/src/features/ai/transcriptView";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { TranscriptSourceControl } from "../src/renderer/src/components/settings/TranscriptSourceControl";

const sentence = (id: string, startMs: number, text: string) => ({
  id,
  recordingId: "r",
  startMs,
  endMs: startMs + 1500,
  text,
  speakerId: "member",
  confidence: "high" as const,
});
test("clickable text runs retain each sentence offset inside a merged paragraph", () => {
  const sources = [
    sentence("one", 1000, "第一句话。"),
    sentence("two", 3000, "第二句话。"),
    sentence("three", 5000, "第三句话。"),
  ];
  const paragraph = buildReadableTranscriptParagraphs(sources)[0]!;
  assert.equal(paragraph.sourceSegments.length, 3);
  const runs = transcriptSeekRuns(paragraph);
  assert.equal(runs.map((run) => run.text).join(""), paragraph.text);
  assert.equal(runs.find((run) => run.text.includes("第三"))?.startMs, 5000);
  const words = transcriptSeekRuns({
    ...paragraph,
    words: [
      { id: "w1", text: "第一", startMs: 1100, endMs: 1400 },
      { id: "w2", text: "句话", startMs: 1600, endMs: 1900 },
      { id: "w3", text: "第二句话", startMs: 3100, endMs: 4400 },
      { id: "w4", text: "第三句话", startMs: 5100, endMs: 6400 },
    ],
  });
  assert.equal(words.find((run) => run.text.includes("第三"))?.startMs, 5100);
  assert.equal(words.map((run) => run.text).join(""), paragraph.text);
});

test("display source follows the saved result and explicit view, never the currently selected model", () => {
  const local = sentence("local", 5200, "本地识别。"),
    cloud = sentence("cloud", 0, "云端识别。");
  const record = {
    ...createEmptyVoiceMemoryRecord({ recordingId: "r", filePath: "fixture.wav" }),
    transcriptionModel: { id: "paraformer-zh" as const, name: "Paraformer" },
    transcript: [local],
    transcriptionAssist: {
      status: "running" as const,
      cloudModelId: "siliconflow-sensevoice-small" as const,
      localModelId: "paraformer-zh" as const,
    },
    transcriptionVariants: {
      "siliconflow-sensevoice-small": {
        model: { id: "siliconflow-sensevoice-small" as const, name: "SenseVoice" },
        transcript: [cloud],
        speakers: [],
        updatedAt: "2026-10-20",
      },
    },
  };
  const options = transcriptViewOptions(record);
  assert.equal(options.length, 2);
  assert.equal(resolveTranscriptView(record, "auto")?.kind, "cloud");
  assert.equal(resolveTranscriptView(record, "local")?.transcript[0]?.startMs, 5200);
  assert.equal(resolveTranscriptView(record, "cloud")?.transcript[0]?.startMs, 0);
  assert.equal(resolveTranscriptView(record, "cloud")?.estimated, true);
  assert.equal(resolveTranscriptView(record, "local")?.estimated, false);
  assert.deepEqual(
    record.transcript,
    [local],
    "switching the view does not rewrite either original",
  );
});

test("unreviewed retained fusion requires explicit selection while partial review reports uncertainty", () => {
  const local = sentence("local", 5200, "本地识别。"),
    cloud = sentence("cloud", 0, "云端识别。");
  const record: VoiceMemoryRecord = {
    ...createEmptyVoiceMemoryRecord({ recordingId: "r", filePath: "fixture.wav" }),
    transcriptionModel: { id: "paraformer-zh", name: "Paraformer" },
    transcript: [local],
    transcriptionAssist: {
      status: "completed",
      cloudModelId: "siliconflow-sensevoice-small",
      localModelId: "paraformer-zh",
    },
    transcriptionVariants: {
      "siliconflow-sensevoice-small": {
        model: { id: "siliconflow-sensevoice-small", name: "SenseVoice" },
        transcript: [cloud],
        speakers: [],
        updatedAt: "2026-10-20",
      },
    },
    transcriptionFusion: {
      status: "failed",
      errorCode: "fusion_unreviewed",
      sourceSignature: "fixture",
      completedBatches: 1,
      totalBatches: 1,
      speakers: [],
      transcript: [{ ...local, fusionUncertain: true }],
    },
  };
  assert.equal(resolveTranscriptView(record)?.kind, "cloud");
  assert.equal(resolveTranscriptView(record, "fusion")?.label, "未校对的保留稿");
  assert.equal(resolveTranscriptView(record, "fusion")?.transcript[0]?.startMs, 5200);
  record.transcriptionFusion!.status = "completed";
  assert.equal(
    resolveTranscriptView(record)?.kind,
    "cloud",
    "legacy completed flags cannot promote fully unreviewed text",
  );
  record.transcriptionFusion!.transcript.push({
    ...sentence("reviewed", 8000, "核对完成。"),
    fusionUncertain: false,
  });
  const reviewed = resolveTranscriptView(record);
  assert.equal(reviewed?.kind, "fusion");
  assert.match(reviewed!.label, /1句待核对/);
  assert.equal(reviewed?.reviewedCount, 1);
  assert.equal(reviewed?.textUnchanged, undefined);
  record.transcriptionFusion!.transcript = [{ ...local }];
  assert.equal(resolveTranscriptView(record)?.kind, "cloud", "missing review flags are unknown");
  assert.equal(resolveTranscriptView(record, "fusion")?.reviewedCount, undefined);
  record.transcriptionVariants!["paraformer-zh"] = {
    model: { id: "paraformer-zh", name: "Paraformer" },
    transcript: [local],
    speakers: [],
    updatedAt: "2026-10-20",
  };
  record.transcriptionFusion!.transcript = [{ ...local, fusionUncertain: false }];
  assert.equal(resolveTranscriptView(record)?.reviewedCount, 1);
  assert.equal(resolveTranscriptView(record)?.textUnchanged, true);
  const unchanged = resolveTranscriptView(record)!;
  const sourceHtml = renderToStaticMarkup(
    createElement(TranscriptSourceControl, {
      view: unchanged,
      options: [unchanged],
      choice: "auto",
      onChange: () => {},
    }),
  );
  assert.match(sourceHtml, /已校对 1 句/);
  assert.match(sourceHtml, /无文字修改/);
  record.transcriptionFusion!.transcript[0]!.text = "核对后文字改变。";
  assert.equal(resolveTranscriptView(record)?.textUnchanged, false);
  record.transcriptionFusion!.status = "failed";
  assert.equal(resolveTranscriptView(record, "fusion")?.reviewedCount, undefined);
  const retained = resolveTranscriptView(record, "fusion")!;
  assert.doesNotMatch(
    renderToStaticMarkup(
      createElement(TranscriptSourceControl, {
        view: retained,
        options: [retained],
        choice: "fusion",
        onChange: () => {},
      }),
    ),
    /已校对|无文字修改/,
  );
});
