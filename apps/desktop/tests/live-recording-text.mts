// Manual opt-in probe. Sends only the synthetic dialogue below, never saved user transcripts.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CustomAiProviderStore } from "../src/main/custom-ai-provider-store";
import { AiTextGateway } from "../src/main/ai-text-gateway";
import { VoiceMemoryOrganizer } from "../src/main/voice-memory-organizer";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import { fuseTranscripts } from "../src/main/transcript-fusion";
import {
  readBoundedProviderFile,
  recoverProviderPlaintext,
} from "../src/main/provider-encryption-recovery";
import type { VoiceMemoryRecord } from "@private-voice/shared";
const report = (serialized: string) => process.stdout.write(`${serialized}\n`);

if (process.env.SHANGHAO_LIVE_RECORDING_PROBE !== "1") throw Error("manual_probe_opt_in_required");
const profile = path.join(process.env.APPDATA!, "shanghao-desktop");
const file = path.join(profile, "ai", "custom-provider.enc");
const encrypted = await readBoundedProviderFile(file);
const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
let plaintext = await recoverProviderPlaintext(encrypted, process.env.APPDATA!);
if (!plaintext) throw Error("existing_provider_context_unavailable");
const config = JSON.parse(plaintext) as { baseUrl: string };
if (config.baseUrl.replace(/\/$/, "") !== "https://open.bigmodel.cn/api/paas/v4")
  throw Error("unexpected_probe_destination");
const custom = new CustomAiProviderStore(undefined, profile, {
  isEncryptionAvailable: () => true,
  decryptString: () => plaintext!,
  encryptString: () => {
    throw Error("probe_must_not_write_credentials");
  },
});
const gateway = new AiTextGateway(
  { getSnapshot: () => ({ aiOrganizerProvider: "custom" }) } as never,
  {} as never,
  {} as never,
  { getJoinedRoomId: () => undefined } as never,
  custom,
  {} as never,
);
const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-text-probe-"));
const store = new VoiceMemoryStore(directory);
await store.initialize();
const signal = AbortSignal.timeout(180000);
const started = Date.now();
try {
  const local = [
    "八点开黑，我绝对不送。",
    "你刚刚二十分钟送了八次。",
    "打完点麻辣烫，不要香才。",
  ].map((text, index) => ({
    id: `local-${index}`,
    recordingId: "synthetic-text-probe",
    text,
    speakerId: index === 1 ? "b" : "a",
    startMs: index * 5000,
    endMs: index * 5000 + 4000,
  }));
  const cloud = local.map((row, index) => ({
    ...row,
    id: `cloud-${index}`,
    text: row.text.replace("香才", "香菜"),
  }));
  let record: VoiceMemoryRecord = {
    ...createEmptyVoiceMemoryRecord({
      recordingId: "synthetic-text-probe",
      filePath: path.join(directory, "synthetic-only.wav"),
    }),
    phase: "ready",
    taskStatus: "success",
    transcript: cloud,
    transcriptionAssist: {
      status: "completed",
      cloudModelId: "siliconflow-sensevoice-small",
      localModelId: "qwen3-asr-0.6b-force",
    },
    transcriptionVariants: {
      "siliconflow-sensevoice-small": {
        model: { id: "siliconflow-sensevoice-small", name: "synthetic-cloud-fixture" },
        transcript: cloud,
        speakers: [],
        updatedAt: new Date().toISOString(),
      },
      "qwen3-asr-0.6b-force": {
        model: { id: "qwen3-asr-0.6b-force", name: "synthetic-local-fixture-not-model-inference" },
        transcript: local,
        speakers: [],
        updatedAt: new Date().toISOString(),
      },
    },
  };
  const originals = hash(JSON.stringify(record.transcriptionVariants));
  record = await fuseTranscripts(record, {
    signal,
    manual: true,
    save: (next) => store.save(next),
    generate: (request) => gateway.generateJson(request),
  });
  assert.equal(record.transcriptionFusion?.status, "completed");
  assert.equal(hash(JSON.stringify(record.transcriptionVariants)), originals);
  const fused = record.transcriptionFusion!.transcript;
  assert.equal(fused.find((row) => row.id === "local-2")?.text, "打完点麻辣烫，不要香菜。");
  const organizer = new VoiceMemoryOrganizer(gateway, (next) => store.save(next));
  record = await organizer.organize(record, false, signal);
  assert.equal(record.organization?.status, "completed");
  assert.ok(record.description || record.summary.length);
  assert.equal(hash(JSON.stringify(record.transcriptionVariants)), originals);
  report(
    JSON.stringify({
      source: "synthetic_dialogue_only",
      realLocalAsr: false,
      fusionStatus: record.transcriptionFusion?.status,
      changedRows: fused.filter(
        (row) => local.find((original) => original.id === row.id)?.text !== row.text,
      ).length,
      summaryStatus: record.organization?.status,
      summary: record.description,
      originalsUnchanged: true,
      elapsedMs: Date.now() - started,
    }),
  );
} catch (error) {
  report(
    JSON.stringify({
      errorCode:
        error instanceof Error && /^[a-z0-9_:-]{1,120}$/i.test(error.message)
          ? error.message
          : "synthetic_text_probe_failed",
    }),
  );
  process.exitCode = 1;
} finally {
  plaintext = undefined;
  report(
    JSON.stringify({
      credentialFileUnchanged: hash(encrypted) === hash(await readBoundedProviderFile(file)),
    }),
  );
  await rm(directory, { recursive: true, force: true });
}
