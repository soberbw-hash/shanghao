import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VoiceReplayStore, validateReplayWave } from "../src/main/voice-replay-store";
import { encodeVoiceReplayWave } from "../src/renderer/src/features/recording/voiceReplayWave";

async function fixture(
  run: (store: VoiceReplayStore, root: string, trash: string) => Promise<void>,
) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "shanghao-replay-test-"));
  const root = path.join(base, "library"),
    trash = path.join(base, "trash");
  await fs.mkdir(trash);
  const store = new VoiceReplayStore(root, (target) =>
    fs.rename(target, path.join(trash, path.basename(target))),
  );
  try {
    await run(store, root, trash);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
}
const wave = () =>
  encodeVoiceReplayWave(
    Float32Array.from({ length: 16000 }, (_, i) => Math.sin(i / 20) * 0.2),
    8000,
  );

test("replay clips commit independently, survive restart, and trim without changing originals", () =>
  fixture(async (store, root, trash) => {
    const input = wave();
    const saving = store.save("刚才的对话", input);
    input.fill(0);
    const clip = await saving;
    const original = await store.read(clip.id);
    assert.equal(validateReplayWave(original).durationMs, 2000);
    const cropped = await store.trim(clip.id, 250, 1250);
    assert.equal(cropped.durationMs, 1000);
    assert.deepEqual(await store.read(clip.id), original);
    await store.rename(clip.id, "神级发言");
    assert.equal((await store.list()).find((item) => item.id === clip.id)?.title, "神级发言");
    const restarted = new VoiceReplayStore(root, async () => {
      throw Error("trash unavailable");
    });
    assert.equal((await restarted.list()).length, 2);
    await assert.rejects(restarted.remove(clip.id), /trash unavailable/);
    assert.deepEqual(await restarted.read(clip.id), original);
    await store.remove(clip.id);
    assert.equal((await store.list()).length, 1);
    assert.deepEqual(await fs.readFile(path.join(trash, clip.id, "audio.wav")), original);
    await fs.mkdir(path.join(root, ".creating-interrupted"));
    assert.equal((await restarted.list()).length, 1);
  }));

test("replay store refuses traversal, oversized/malformed waves and corrupt existing metadata", () =>
  fixture(async (store, root) => {
    await assert.rejects(store.read("../recordings"), /invalid_replay_id/);
    assert.throws(() => store.save("bad", new Uint8Array(44)), /invalid_replay_audio/);
    const malformed = wave();
    malformed[28] = 0;
    assert.throws(() => store.save("bad", malformed), /invalid_replay_audio/);
    const clip = await store.save("保留", wave());
    await assert.rejects(store.trim(clip.id, -1, 2000), /invalid_replay_trim/);
    await assert.rejects(store.trim(clip.id, 2, 2), /invalid_replay_trim/);
    await fs.writeFile(path.join(root, clip.id, "clip.json"), "broken");
    await assert.rejects(store.save("不覆盖", wave()));
    assert.equal(await fs.readFile(path.join(root, clip.id, "clip.json"), "utf8"), "broken");
  }));

test("explicit local transcription validates the clip without blocking another save", () =>
  fixture(async (store, root) => {
    const original = await store.save("原片段", wave());
    const before = await store.read(original.id);
    let release!: () => void;
    let modelPath = "",
      modelDuration = 0;
    const pending = store.transcribeLocal(original.id, async (filePath, duration) => {
      modelPath = filePath;
      modelDuration = duration;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return "本地文字";
    });
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(path.basename(modelPath), "audio.wav");
    assert.equal(modelDuration, original.durationMs);
    const another = await store.save("另一个片段", wave());
    assert.notEqual(another.id, original.id);
    await assert.rejects(store.remove(original.id), /voice_replay_transcription_busy/);
    await assert.rejects(
      store.transcribeLocal(original.id, async () => "重复"),
      /voice_replay_transcription_busy/,
    );
    release();
    assert.equal(await pending, "本地文字");
    assert.equal(await store.readTranscript(original.id), "本地文字");
    const reopened = new VoiceReplayStore(root, async () => undefined);
    assert.equal(await reopened.readTranscript(original.id), "本地文字");
    assert.deepEqual(await store.read(original.id), before);
    let invoked = false;
    await assert.rejects(
      store.transcribeLocal("../other", async () => {
        invoked = true;
        return "";
      }),
    );
    assert.equal(invoked, false);
    await assert.rejects(
      store.transcribeLocal(original.id, async () => {
        throw Error("model unavailable");
      }),
      /model unavailable/,
    );
    await store.remove(original.id);
  }));

test("unknown transcript data is preserved and never overwritten", () =>
  fixture(async (store, root) => {
    const clip = await store.save("原片段", wave());
    const name = "transcript-00000000-0000-0000-0000-000000000001.json";
    const target = path.join(root, clip.id, name);
    const unknown = '{"version":2,"text":"未来版本"}';
    await fs.writeFile(target, unknown);
    await assert.rejects(store.readTranscript(clip.id), /invalid_replay_transcript/);
    let invoked = false;
    await assert.rejects(
      store.transcribeLocal(clip.id, async () => {
        invoked = true;
        return "新文字";
      }),
      /invalid_replay_transcript/,
    );
    assert.equal(invoked, false);
    assert.equal(await fs.readFile(target, "utf8"), unknown);
    assert.equal(
      (await fs.readdir(path.join(root, clip.id))).filter((file) => file.startsWith("transcript-"))
        .length,
      1,
    );
    assert.ok((await store.read(clip.id)).length > 44);
  }));

test("structured replay transcripts preserve actual times and reject invalid output without replacing older text", () =>
  fixture(async (store, root) => {
    const clip = await store.save("原片段", wave());
    await store.transcribeLocal(clip.id, async () => "旧版纯文字");
    assert.equal((await store.readTranscriptDetail(clip.id))?.version, 1);
    const result = {
      text: "你好。",
      sourceModel: "qwen3-asr-0.6b-force",
      segments: [
        { text: "你好。", startMs: 120, endMs: 900, timestampPrecision: "aligned" as const },
      ],
    };
    await store.transcribeLocal(clip.id, async () => result);
    const reopened = new VoiceReplayStore(root, async () => undefined);
    const saved = await reopened.readTranscriptDetail(clip.id);
    assert.equal(saved?.version, 2);
    if (saved?.version !== 2) throw Error("structured result missing");
    assert.deepEqual(saved.segments, result.segments);
    const edited = await store.reviseTranscriptSegment(clip.id, saved.createdAt, 0, "你好呀。");
    assert.equal(edited.version, 2);
    if (edited.version !== 2) throw Error("structured revision missing");
    assert.equal(edited.text, "你好呀。");
    assert.deepEqual(edited.segments[0], {
      ...result.segments[0],
      text: "你好呀。",
      reviewStatus: "edited",
    });
    await assert.rejects(
      store.reviseTranscriptSegment(clip.id, saved.createdAt, 0, "迟到的修订"),
      /voice_replay_transcript_changed/,
    );
    const before = await fs.readdir(path.join(root, clip.id));
    await assert.rejects(
      store.transcribeLocal(clip.id, async () => ({
        ...result,
        segments: [{ ...result.segments[0]!, endMs: 3000 }],
      })),
      /invalid_replay_transcript/,
    );
    assert.deepEqual(await fs.readdir(path.join(root, clip.id)), before);
    assert.deepEqual(await reopened.readTranscriptDetail(clip.id), edited);
    assert.equal((await store.read(clip.id)).length, clip.byteLength);
  }));

test("trim retains only complete timestamped sentences, with shifted times and edits", () =>
  fixture(async (store, root) => {
    const clip = await store.save("原片段", wave());
    await store.transcribeLocal(clip.id, async () => ({
      text: "前一句 完整一句 后一句",
      sourceModel: "test-model",
      segments: [
        { text: "前一句", startMs: 100, endMs: 500, timestampPrecision: "aligned" as const },
        { text: "完整一句", startMs: 600, endMs: 1000, timestampPrecision: "aligned" as const },
        { text: "后一句", startMs: 1100, endMs: 1600, timestampPrecision: "chunk" as const },
      ],
    }));
    const before = await store.readTranscriptDetail(clip.id);
    if (!before || before.version !== 2) throw Error("structured result missing");
    await store.reviseTranscriptSegment(clip.id, before.createdAt, 1, "修改后的一句");
    const cropped = await store.trim(clip.id, 250, 1250);
    const reopened = new VoiceReplayStore(root, async () => undefined);
    const result = await reopened.readTranscriptDetail(cropped.id);
    assert.equal(result?.version, 2);
    if (!result || result.version !== 2) throw Error("trim transcript missing");
    assert.equal(result.derivedFromTrim, true);
    assert.equal(result.text, "修改后的一句");
    assert.deepEqual(result.segments, [
      {
        text: "修改后的一句",
        startMs: 350,
        endMs: 750,
        timestampPrecision: "aligned",
        reviewStatus: "edited",
      },
    ]);
    assert.equal(
      (await reopened.readTranscriptDetail(clip.id))?.text,
      "前一句 修改后的一句 后一句",
    );
    const noWholeSentence = await store.trim(clip.id, 250, 450);
    assert.equal(await reopened.readTranscriptDetail(noWholeSentence.id), undefined);
    const legacy = await store.save("旧片段", wave());
    await store.transcribeLocal(legacy.id, async () => "没有时间戳的旧文字");
    assert.equal(
      await reopened.readTranscriptDetail((await store.trim(legacy.id, 250, 450)).id),
      undefined,
    );
  }));

test("concurrent replay saves have distinct IDs and complete audio/metadata pairs", () =>
  fixture(async (store) => {
    const clips = await Promise.all(
      Array.from({ length: 8 }, (_, i) => store.save("片段" + i, wave())),
    );
    assert.equal(new Set(clips.map((c) => c.id)).size, 8);
    assert.equal((await store.list()).length, 8);
    for (const clip of clips) assert.equal((await store.read(clip.id)).length, clip.byteLength);
  }));
