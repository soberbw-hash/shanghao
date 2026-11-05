import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CURRENT_TRANSCRIPTION_PIPELINE_VERSION } from "@private-voice/shared";
import {
  findFingerprintMatchedSourcePlan,
  selectSpeakerSourcesForResume,
} from "../src/main/voice-memory-source-plan";
import { verifySource } from "../src/main/voice-memory-source-integrity";

test("completed checkpoint fingerprints disambiguate identical speaker timelines", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-source-plan-"));
  try {
    const speechPath = path.join(directory, "speech.wav");
    const participantPath = path.join(directory, "participant.wav");
    await writeFile(speechPath, "speech source");
    await writeFile(participantPath, "participant source");
    const speech = {
      speakerId: "account-a",
      accountIdentity: "account-a",
      displayNameSnapshot: "A",
      startMs: 0,
      endMs: 1_000,
      audioOffsetMs: 0,
      filePath: speechPath,
    };
    const participant = { ...speech, filePath: participantPath };
    const durableUnits = [
      {
        startMs: 0,
        endMs: 1_000,
        speakerId: "account-a",
        status: "completed",
        sourceFingerprint: await verifySource(speech),
      },
    ];
    const plan = await findFingerprintMatchedSourcePlan([speech], [participant], durableUnits);
    assert.equal(plan, "speech");
    const selection = selectSpeakerSourcesForResume(
      [speech],
      [participant],
      durableUnits,
      {
        totalUnits: 1,
        pipelineVersion: CURRENT_TRANSCRIPTION_PIPELINE_VERSION,
        asrModelId: "qwen3-asr-0.6b-force",
      },
      "qwen3-asr-0.6b-force",
      plan,
    );
    assert.deepEqual(
      selection.knownSpeakerSegments.map((source) => source.filePath),
      [speechPath],
    );
    assert.equal(selection.ambiguousLegacyPlan, false);

    await writeFile(speechPath, "changed source with a different length");
    assert.equal(
      await findFingerprintMatchedSourcePlan([speech], [participant], durableUnits),
      undefined,
      "changed audio cannot claim a saved source fingerprint",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
