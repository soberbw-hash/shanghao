import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { chatMixLeaseJournal } from "../src/main/chat-mix-lease-journal";
import { ChatMixVolumeLeases, type ChatMixSession } from "../src/main/chat-mix-volume-leases";

test("real journal survives a lost native reply and a new owner restores the original session", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-chat-mix-"));
  try {
    const file = path.join(directory, "leases.json"),
      journal = chatMixLeaseJournal(file);
    assert.deepEqual(await journal.read(), []);
    const session: ChatMixSession = {
      deviceId: "fixture",
      instanceId: "stable-instance",
      processId: 42,
      volume: 0.8,
      muted: false,
    };
    let fail = true;
    const backend = {
      list: async () => [{ ...session }],
      isProcessAlive: () => true,
      change: async (_target: unknown, expected: number, value: number) => {
        const written = await journal.read();
        assert.equal(written[0]?.original, 0.8);
        assert.equal(written[0]?.intended, 0.4);
        assert.equal(session.volume, expected);
        session.volume = value;
        if (fail) throw Error("synthetic worker exit");
        return { ok: true };
      },
    };
    const first = await ChatMixVolumeLeases.open(backend, journal);
    await assert.rejects(first.attenuate(session, 0.5, new Set()), /worker exit/);
    assert.equal(session.volume, 0.4);
    fail = false;
    const recovered = await ChatMixVolumeLeases.open(backend, chatMixLeaseJournal(file));
    assert.deepEqual(await recovered.restore(), { pending: 0 });
    assert.equal(session.volume, 0.8);
    assert.deepEqual(await journal.read(), []);
    assert.deepEqual(
      await readdir(directory),
      ["leases.json"],
      "successful atomic writes leave no temporary files",
    );
    await writeFile(file, "damaged recovery content");
    await assert.rejects(ChatMixVolumeLeases.open(backend, journal));
    await assert.rejects(journal.write([]));
    assert.equal(await readFile(file, "utf8"), "damaged recovery content");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
