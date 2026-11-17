import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CloudAiRuntime } from "../../../packages/signaling/src/cloud-ai-runtime";

test("WebM goes to DeepSeek as Ogg Opus; a 503 falls back with the original audio", async (t) => {
  assert.ok(ffmpegPath);
  const old = process.env.SHANGHAO_ASR_FFMPEG;
  process.env.SHANGHAO_ASR_FFMPEG = ffmpegPath;
  t.after(() => {
    if (old === undefined) delete process.env.SHANGHAO_ASR_FFMPEG;
    else process.env.SHANGHAO_ASR_FFMPEG = old;
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-asr-routing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "providers.json");
  await writeFile(
    file,
    JSON.stringify({
      revision: 1,
      providers: [
        {
          id: "primary",
          kind: "speech",
          name: "DeepSeek",
          baseUrl: "https://api.deepseek.com",
          model: "deepseek-asr",
          apiKey: "fixture-primary",
          active: true,
        },
        {
          id: "backup",
          kind: "speech",
          name: "Backup",
          baseUrl: "https://api.siliconflow.cn/v1",
          model: "SenseVoice",
          apiKey: "fixture-backup",
          active: false,
          fallback: true,
        },
      ],
    }),
    { mode: 0o600 },
  );
  const webm = execFileSync(ffmpegPath, [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=1",
    "-c:a",
    "libopus",
    "-f",
    "webm",
    "pipe:1",
  ]);
  const seen: string[] = [];
  const replacement = t.mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, options?: RequestInit) => {
      const target = String(url);
      seen.push(target);
      const form = options?.body as FormData;
      const blob = form.get("file") as Blob;
      const bytes = Buffer.from(await blob.arrayBuffer());
      if (new URL(target).hostname === "api.deepseek.com") {
        assert.equal(bytes.toString("ascii", 0, 4), "OggS");
        assert.ok(bytes.includes(Buffer.from("OpusHead")));
        assert.equal(form.has("model"), false);
        return new Response("", { status: 503 });
      }
      assert.equal(bytes.equals(webm), true);
      assert.equal(form.get("model"), "SenseVoice");
      return new Response('{"text":"备用结果"}');
    },
  );
  const runtime = new CloudAiRuntime(Promise.resolve({} as never), undefined, undefined, file);
  const result = await runtime.speechService.transcribe(
    webm,
    "audio/webm;codecs=opus",
    new AbortController().signal,
  );
  assert.equal(result.text, "备用结果");
  assert.equal(result.modelName, "SenseVoice");
  assert.deepEqual(seen, [
    "https://api.deepseek.com/v1/tools/asr",
    "https://api.siliconflow.cn/v1/audio/transcriptions",
  ]);
  replacement.mock.restore();
});
