import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, link } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  RecordingRecycleBin,
  RECORDING_RECYCLE_RETENTION_MS,
} from "../src/main/recording-recycle-bin";
import {
  markerPathFor,
  readRecordingLibraryFromDirectory,
  renameRecordingInDirectory,
  setRecordingFavoriteInDirectory,
} from "../src/main/recording-library-core";
import { SharedVoiceMemoryStore } from "../src/main/shared-voice-memory-store";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";
import type { RecordingRecycleHooks } from "../src/main/recording-recycle-bin";

async function fixture(t: test.TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-recycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "audio");
  await mkdir(directory);
  const file = path.join(directory, "录音 01.m4a");
  await writeFile(file, "original audio");
  const library = () => readRecordingLibraryFromDirectory(directory, 20);
  const item = (await library()).items[0]!;
  const store = new SharedVoiceMemoryStore(path.join(root, "memory"));
  await store.initialize();
  const record = await store.save({
    ...createEmptyVoiceMemoryRecord({ recordingId: item.recordingId, filePath: file }),
    phase: "ready",
    progress: 100,
    transcript: [
      { id: "line", recordingId: item.recordingId, text: "保留这句原文", startMs: 0, endMs: 2000 },
    ],
  });
  const track = path.join(root, "participant-track.m4a");
  await writeFile(track, "independent track");
  let now = Date.now();
  let failSuspend = false;
  let failRestore = false;
  let purges = 0;
  const hooks: RecordingRecycleHooks = {
    suspend: async (entry, token) => {
      if (failSuspend) throw Error("suspend_failed");
      await store.setRecycled(entry.recordingId, token, true);
    },
    resume: async (entry, token) => {
      if (failRestore) throw Error("resume_failed");
      await store.setRecycled(entry.recordingId, token, false);
    },
    purge: async (entry, token) => {
      await store.setRecycled(entry.recordingId, token, true);
      await store.delete(entry.recordingId);
      await rm(track, { force: true });
      purges++;
    },
  };
  const bin = () => new RecordingRecycleBin(directory, hooks, () => now);
  return {
    root,
    directory,
    file,
    item,
    store,
    record,
    track,
    library,
    bin,
    advance: (ms: number) => {
      now += ms;
    },
    failSuspend: (v: boolean) => {
      failSuspend = v;
    },
    failRestore: (v: boolean) => {
      failRestore = v;
    },
    purges: () => purges,
  };
}

test("recycle retains audio, markers, stable identity, favorites, ASR and independent tracks across restart", async (t) => {
  const f = await fixture(t);
  await writeFile(markerPathFor(f.file), "00:00:01 · 精彩时刻\n");
  await setRecordingFavoriteInDirectory(f.directory, f.file, true);
  const named = await renameRecordingInDirectory(f.directory, f.item.recordingId, "我们的精彩一局");
  const audio = await readFile(named.filePath);
  await f.bin().recycle(named);
  assert.equal((await f.library()).items.length, 0);
  assert.equal(await f.store.get(named.recordingId), undefined);
  assert.deepEqual(await f.store.list(), []);
  assert.deepEqual(await f.store.listSummaries(), []);
  assert.deepEqual(f.store.search({ query: "原文" }), []);
  assert.equal(await readFile(f.track, "utf8"), "independent track");
  const store2 = new SharedVoiceMemoryStore(path.join(f.root, "memory"));
  await store2.initialize();
  await assert.rejects(store2.save(f.record), /recycled/);
  const [entry] = await f.bin().list();
  assert.ok(entry);
  await f.bin().restore(entry.id);
  const restored = (await f.library()).items[0]!;
  assert.equal(restored.recordingId, named.recordingId);
  assert.equal(restored.title, named.title);
  assert.equal(restored.isFavorite, true);
  assert.equal(restored.markers.length, 1);
  assert.deepEqual(await readFile(restored.filePath), audio);
  assert.equal((await f.store.get(named.recordingId))?.transcript[0]?.text, "保留这句原文");
  assert.equal((await f.bin().list()).length, 0);
});

test("automatic recycling rechecks favorite, markers and immutable file scan identity", async (t) => {
  const f = await fixture(t);
  await setRecordingFavoriteInDirectory(f.directory, f.file, true);
  await assert.rejects(f.bin().recycle(f.item, true), /protected/);
  await setRecordingFavoriteInDirectory(f.directory, f.file, false);
  await writeFile(markerPathFor(f.file), "00:00:02\n");
  await assert.rejects(f.bin().recycle(f.item, true), /protected/);
  await rm(markerPathFor(f.file));
  await writeFile(f.file, "changed audio bytes");
  await assert.rejects(f.bin().recycle(f.item, true), /changed_since_scan/);
  assert.equal((await f.bin().list()).length, 0);
});

test("failed suspend and interrupted hard-link move recover from journal without losing original", async (t) => {
  const f = await fixture(t);
  f.failSuspend(true);
  f.failRestore(true);
  await assert.rejects(f.bin().recycle(f.item), /resume_failed/);
  assert.equal(await readFile(f.file, "utf8"), "original audio");
  const root = path.join(f.directory, ".shanghao-recycle-bin");
  const [id] = (await readdir(root)).filter((name) => /^[a-f0-9-]{36}$/.test(name));
  assert.ok(id);
  await link(f.file, path.join(root, id, "audio.m4a"));
  f.failSuspend(false);
  f.failRestore(false);
  const entries = await f.bin().list();
  assert.equal(entries.length, 1);
  assert.equal((await f.library()).items.length, 0);
  await f.bin().restore(id);
  assert.equal(await readFile(f.file, "utf8"), "original audio");
});

test("restoring is resumable after audio moved but metadata activation failed", async (t) => {
  const f = await fixture(t);
  await f.bin().recycle(f.item);
  const entry = (await f.bin().list())[0]!;
  f.failRestore(true);
  await assert.rejects(f.bin().restore(entry.id), /resume_failed/);
  assert.equal(await readFile(f.file, "utf8"), "original audio");
  assert.equal(await f.store.get(f.item.recordingId), undefined);
  f.failRestore(false);
  assert.equal((await f.bin().list()).length, 0);
  assert.ok(await f.store.get(f.item.recordingId));
});

test("a reused file name obtains a new identity; neither restore nor expiry overwrites it", async (t) => {
  const f = await fixture(t);
  await f.bin().recycle(f.item);
  await writeFile(f.file, "new recording", { flag: "wx" });
  const imported = (await f.library()).items[0]!;
  assert.notEqual(imported.recordingId, f.item.recordingId);
  const entry = (await f.bin().list())[0]!;
  await assert.rejects(f.bin().restore(entry.id), /conflict/);
  f.advance(RECORDING_RECYCLE_RETENTION_MS + 1);
  assert.equal(await f.bin().purgeExpired(), 0);
  assert.equal(f.purges(), 0);
  assert.equal(await readFile(f.file, "utf8"), "new recording");
});

test("restoration advances even a ready revision so a late shared writer cannot replace the restored text", async (t) => {
  const f = await fixture(t);
  const olderProcess = new SharedVoiceMemoryStore(path.join(f.root, "memory"));
  await olderProcess.initialize();
  const stale = (await olderProcess.get(f.item.recordingId))!;
  await f.bin().recycle(f.item);
  const entry = (await f.bin().list())[0]!;
  await f.bin().restore(entry.id);
  await assert.rejects(olderProcess.save({ ...stale, transcript: [] }), /shared_result_changed/);
  assert.equal((await f.store.get(f.item.recordingId))?.transcript[0]?.text, "保留这句原文");
});

test("seven-day expiry preserves every byte until due, then clears associated data", async (t) => {
  const f = await fixture(t);
  await f.bin().recycle(f.item);
  f.advance(RECORDING_RECYCLE_RETENTION_MS - 1);
  assert.equal(await f.bin().purgeExpired(), 0);
  assert.equal(f.purges(), 0);
  f.advance(1);
  assert.equal(await f.bin().purgeExpired(), 1);
  assert.equal(f.purges(), 1);
  assert.equal((await f.bin().list()).length, 0);
  await assert.rejects(readFile(f.track), { code: "ENOENT" });
  await assert.rejects(f.store.save(f.record), /recycled|shared_result_changed/);
});

test("corrupt manifests and foreign tokens stop maintenance and preserve stored audio", async (t) => {
  const f = await fixture(t);
  await f.bin().recycle(f.item);
  const entry = (await f.bin().list())[0]!;
  await assert.rejects(f.store.setRecycled(f.item.recordingId, randomUUID(), false), /conflict/);
  const manifest = path.join(f.directory, ".shanghao-recycle-bin", entry.id, "entry.json");
  await writeFile(manifest, "{bad json");
  f.advance(RECORDING_RECYCLE_RETENTION_MS + 1);
  await assert.rejects(f.bin().purgeExpired());
  assert.equal(f.purges(), 0);
  assert.equal(
    await readFile(path.join(path.dirname(manifest), "audio.m4a"), "utf8"),
    "original audio",
  );
  await assert.rejects(f.bin().restore("../outside"), /invalid/);
});
