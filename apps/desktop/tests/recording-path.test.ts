import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  createNumberedRecordingFileName,
  RECORDING_DIRECTORY_NAME,
  resolveAvailableRecordingPath,
  resolveRecordingDirectory,
  sanitizeRecordingFileName,
} from "../src/main/recording-path";

test("recording filenames use readable daily room numbering", () => {
  const createdAt = new Date(2026, 7, 13, 0, 47, 26);
  assert.equal(
    createNumberedRecordingFileName("一号房", createdAt, [
      "上号-一号房-2026-08-13-00-20-00.m4a",
      "上号-2026-08-13-一号房-02-00-30-00.m4a",
      "上号-2026-08-12-一号房-08-23-30-00.m4a",
      "上号-2026-08-13-二号房-04-00-40-00.m4a",
    ]),
    "上号-2026-08-13-一号房-03-00-47-26.m4a",
  );
});

test("recordings use the ShangHao documents folder without unsafe filenames", () => {
  assert.equal(RECORDING_DIRECTORY_NAME, "上号录音");
  assert.equal(sanitizeRecordingFileName("上号:2026/08/11?.m4a"), "11-.m4a");
  assert.equal(sanitizeRecordingFileName("voice.webm"), "voice.webm.m4a");
});

test("recording directory uses a persisted absolute folder and rejects damaged values", () => {
  assert.equal(
    resolveRecordingDirectory("D:\\Voice\\Friends", "C:\\Users\\Sober\\Documents"),
    path.normalize("D:\\Voice\\Friends"),
  );
  assert.equal(
    resolveRecordingDirectory("..\\unsafe", "C:\\Users\\Sober\\Documents"),
    path.join("C:\\Users\\Sober\\Documents", RECORDING_DIRECTORY_NAME),
  );
});

test("recording output never overwrites an existing file", async () => {
  const occupied = new Set([path.join("D:\\Recordings", "上号录音.m4a")]);
  const outputPath = await resolveAvailableRecordingPath(
    "D:\\Recordings",
    "上号录音.m4a",
    async (candidate) => occupied.has(candidate),
  );

  assert.equal(outputPath, path.join("D:\\Recordings", "上号录音 (2).m4a"));
});
