import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { defaultSettings, migrateSettings } from "../src/main/settings-migration";
import { SettingsStore } from "../src/main/settings-store";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";

test("N-1 storage fixture preserves settings, account bytes, recording, model and voice checkpoints", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-upgrade-fixture-"));
  try {
    const userData = path.join(root, "user-data");
    const voiceRoot = path.join(userData, "voice-memory");
    const recordingRoot = path.join(root, "recordings");
    const modelRoot = path.join(root, "models");
    await Promise.all([
      mkdir(path.join(voiceRoot, "records"), { recursive: true }),
      mkdir(path.join(voiceRoot, "transcription-events"), { recursive: true }),
      mkdir(recordingRoot, { recursive: true }),
      mkdir(modelRoot, { recursive: true }),
    ]);

    const settings = migrateSettings({
      ...defaultSettings,
      profileId: randomUUID(),
      nickname: "阿北",
      preferredInputDeviceId: "n-1-input",
      preferredOutputDeviceId: "n-1-output",
      recordingSaveDirectory: recordingRoot,
      quickMessages: { ...defaultSettings.quickMessages, soundVolume: 0.38 },
      isBackgroundUpdateCheckEnabled: false,
    }).settings;
    const recordingId = "n-minus-one-recording";
    const recordingPath = path.join(recordingRoot, "room.webm");
    const checkpointPath = path.join(voiceRoot, "transcription-events", `${recordingId}.ndjson`);
    const files = new Map<string, string | Buffer>([
      [path.join(userData, "settings.json"), JSON.stringify(settings, null, 2)],
      [path.join(userData, "account-session.json"), "encrypted-account-session-fixture"],
      [recordingPath, Buffer.from([0x1a, 0x45, 0xdf, 0xa3])],
      [path.join(modelRoot, "model.bin"), Buffer.from([1, 2, 3, 4])],
      [
        path.join(voiceRoot, "records", `${recordingId}.json`),
        JSON.stringify({
          recordingId,
          filePath: recordingPath,
          transcript: [{ id: "segment-1", text: "测试转录", startMs: 0, endMs: 1_000 }],
        }),
      ],
      [
        path.join(voiceRoot, "summaries.json"),
        JSON.stringify({
          schemaVersion: 1,
          entries: [{ recordingId, title: "上次录音" }],
        }),
      ],
      [path.join(voiceRoot, "index.json"), JSON.stringify({ schemaVersion: 1, entries: [] })],
      [checkpointPath, '{"recordedAt":"fixture","unit":{"text":"测试转录"}}\n'],
    ]);
    await Promise.all([...files].map(([file, content]) => writeFile(file, content)));

    const loaded = await new SettingsStore(undefined, userData).load();
    const voiceStore = new VoiceMemoryStore(voiceRoot);
    await voiceStore.initialize();
    assert.equal(loaded.nickname, "阿北");
    assert.equal(loaded.preferredInputDeviceId, "n-1-input");
    assert.equal(loaded.preferredOutputDeviceId, "n-1-output");
    assert.equal(loaded.recordingSaveDirectory, recordingRoot);
    assert.equal(loaded.quickMessages.soundVolume, 0.38);
    assert.equal(loaded.isBackgroundUpdateCheckEnabled, false);
    assert.equal((await voiceStore.get(recordingId))?.recordingId, recordingId);
    assert.equal((await voiceStore.listSummaries())[0]?.recordingId, recordingId);
    assert.equal(voiceStore.search({ query: "测试转录" })[0]?.recordingId, recordingId);

    for (const [file, content] of files) {
      assert.deepEqual(await readFile(file), Buffer.from(content), `Unexpected rewrite: ${file}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
