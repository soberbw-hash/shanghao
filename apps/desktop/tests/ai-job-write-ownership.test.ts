import assert from "node:assert/strict";
import test from "node:test";

import { AiJobWriteOwnership } from "../src/main/ai-job-write-ownership";

test("a deleted job cannot write after a new task takes the same recording id", async () => {
  const ownership = new AiJobWriteOwnership();
  let version = 1;
  let releaseOldJob: (() => void) | undefined;
  const oldJob = ownership.run("recording", version, async () => {
    await new Promise<void>((resolve) => {
      releaseOldJob = resolve;
    });
    ownership.assertCurrent("recording", version);
  });

  // Delete invalidates version 1; reimport and restart clear the tombstone but
  // must never restore version 1's permission to write.
  version = 3;
  releaseOldJob!();
  await assert.rejects(oldJob, /voice_memory_task_superseded/);
  await ownership.run("recording", version, async () => {
    ownership.assertCurrent("recording", version);
  });
  ownership.assertCurrent("recording", version);
});
