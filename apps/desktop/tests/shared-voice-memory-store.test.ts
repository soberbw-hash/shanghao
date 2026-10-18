import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SharedVoiceMemoryStore } from "../src/main/shared-voice-memory-store";
import { VoiceMemoryStore } from "../src/main/voice-memory-store";
import { createEmptyVoiceMemoryRecord } from "../src/main/voice-memory-record";

const fixtureRecord = (id: string, text = "共享转录测试") => ({
  ...createEmptyVoiceMemoryRecord({ recordingId: id, filePath: `C:\\recordings\\${id}.m4a` }),
  phase: "ready" as const,
  progress: 100,
  transcript: [{ id: `${id}-1`, recordingId: id, text, startMs: 0, endMs: 2000 }],
});
const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-shared-memory-"));
  return {
    root,
    shared: path.join(root, "shanghao", "voice-memory"),
    legacy: path.join(root, "shanghao-desktop", "voice-memory"),
  };
};

test("legacy complete results import, newer empty failures never replace shared success", async () => {
  const f = await fixture();
  try {
    const installed = new VoiceMemoryStore(f.shared);
    const legacy = new VoiceMemoryStore(f.legacy);
    await installed.initialize();
    await legacy.initialize();
    const ready = await installed.save(fixtureRecord("shared"));
    await legacy.save({ ...ready, phase: "error", transcript: [], updatedAt: "2099-01-01" });
    await legacy.save(fixtureRecord("development-only"));
    const original = await readFile(path.join(f.legacy, "records", "development-only.json"));
    const shared = new SharedVoiceMemoryStore(f.shared);
    await shared.initialize();
    assert.equal((await shared.get("shared"))?.transcript.length, 1);
    assert.equal((await shared.listSummaries()).length, 2);
    assert.deepEqual(
      await readFile(path.join(f.legacy, "records", "development-only.json")),
      original,
    );
    assert.ok(
      (await readdir(path.join(f.shared, "profile-import-backups", "shanghao-desktop"))).length,
    );
    await shared.delete("development-only");
    await shared.initialize();
    assert.equal(
      await shared.get("development-only"),
      undefined,
      "import ledger prevents resurrection after deletion",
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("legacy success can replace shared failure with an exact previous-record backup", async () => {
  const f = await fixture();
  try {
    const installed = new VoiceMemoryStore(f.shared);
    const legacy = new VoiceMemoryStore(f.legacy);
    await installed.initialize();
    await legacy.initialize();
    const failed = await installed.save({
      ...fixtureRecord("repair"),
      phase: "error",
      transcript: [],
    });
    await legacy.save(fixtureRecord("repair"));
    const shared = new SharedVoiceMemoryStore(f.shared);
    await shared.initialize();
    assert.equal((await shared.get("repair"))?.phase, "ready");
    const backups = path.join(f.shared, "profile-import-backups", "shanghao-desktop");
    const [hash] = await readdir(backups);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(backups, hash!, "previous-shared.json"), "utf8")),
      JSON.parse(JSON.stringify(failed)),
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("two shared instances retain concurrent records and refresh after an older writer updates", async () => {
  const f = await fixture();
  try {
    const a = new SharedVoiceMemoryStore(f.shared),
      b = new SharedVoiceMemoryStore(f.shared);
    await Promise.all([a.initialize(), b.initialize()]);
    await Promise.all([a.save(fixtureRecord("a")), b.save(fixtureRecord("b"))]);
    assert.equal((await a.listSummaries()).length, 2);
    assert.equal((await b.listSummaries()).length, 2);
    const old = new VoiceMemoryStore(f.shared);
    await old.initialize();
    await a.save(fixtureRecord("c"));
    await old.save(fixtureRecord("d")); // Its cached index predates recording c.
    assert.equal(
      (await b.listSummaries()).length,
      4,
      "rebuild from records repairs stale aggregate indexes",
    );
    assert.ok(b.search({ query: "共享转录测试" }).some((entry) => entry.recordingId === "c"));
    const stale = createEmptyVoiceMemoryRecord({
      recordingId: "a",
      filePath: "C:\\recordings\\a.m4a",
    });
    stale.updatedAt = "2000-01-01T00:00:00Z";
    await assert.rejects(b.save(stale), /voice_memory_shared_result_changed/);
    assert.equal((await a.get("a"))?.transcript.length, 1);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("corrupt legacy data is preserved and unrelated profiles stay isolated", async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.legacy, "records"), { recursive: true });
    const broken = path.join(f.legacy, "records", "broken.json");
    await writeFile(broken, "{broken");
    await assert.rejects(new SharedVoiceMemoryStore(f.shared).initialize());
    assert.equal(await readFile(broken, "utf8"), "{broken");
    const isolated = new SharedVoiceMemoryStore(path.join(f.root, "capture", "voice-memory"));
    await isolated.initialize();
    assert.deepEqual(await isolated.listSummaries(), []);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("separate app processes serialize shared index commits", async () => {
  const f = await fixture();
  try {
    const modulePath = path.resolve("src/main/shared-voice-memory-store.ts");
    const run = promisify(execFile);
    await Promise.all(
      ["process-a", "process-b"].map((id) =>
        run(process.execPath, [
          "--import",
          "tsx",
          "--eval",
          `const {SharedVoiceMemoryStore}=require(${JSON.stringify(modulePath)}); (async()=>{
        const store=new SharedVoiceMemoryStore(${JSON.stringify(f.shared)});
        await store.initialize(); await store.save(${JSON.stringify(fixtureRecord(id))});
      })().catch(error=>{console.error(error);process.exitCode=1});`,
        ]),
      ),
    );
    const shared = new SharedVoiceMemoryStore(f.shared);
    await shared.initialize();
    assert.equal((await shared.listSummaries()).length, 2);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
