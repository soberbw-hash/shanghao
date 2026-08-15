import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createNumberedRecordingFileName,
  RECORDING_DIRECTORY_NAME,
  resolveAvailableRecordingPath,
  resolveRecordingDirectory,
  resolveUsableRecordingDirectory,
  sanitizeRecordingFileName,
} from "../src/main/recording-path";
import { defaultSettings, migrateSettings } from "../src/main/settings-migration";

test("recording filenames use one readable sequence per day", () => {
  const createdAt = new Date(2026, 7, 13, 0, 47, 26);
  assert.equal(
    createNumberedRecordingFileName(createdAt, [
      "上号-一号房-2026-08-13-00-20-00.m4a",
      "上号-2026-08-13-一号房-02-00-30-00.m4a",
      "上号-2026-08-12-一号房-08-23-30-00.m4a",
      "上号-2026-08-13-二号房-04-00-40-00.m4a",
    ]),
    "上号-2026-08-13-语音-05-00-47-26.m4a",
  );
});

test("recordings use the ShangHao documents folder without unsafe filenames", () => {
  assert.equal(RECORDING_DIRECTORY_NAME, "上号录音");
  assert.equal(sanitizeRecordingFileName("上号:2026/08/11?.m4a"), "11-.m4a");
  assert.equal(sanitizeRecordingFileName("voice.webm"), "voice.webm.m4a");
});

test("recording directory keeps a custom absolute folder after settings restart", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shanghao-recording-path-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const documentsDirectory = path.join(root, "Documents");
  const customDirectory = path.join(root, "Friends Voice Records");
  await mkdir(documentsDirectory, { recursive: true });

  const savedSettings = migrateSettings({
    ...defaultSettings,
    recordingSaveDirectory: customDirectory,
  }).settings;
  const settingsFile = path.join(root, "settings.json");
  await writeFile(settingsFile, JSON.stringify(savedSettings), "utf8");
  const restartedSettings = migrateSettings(
    JSON.parse(await readFile(settingsFile, "utf8")),
  ).settings;

  assert.equal(
    await resolveUsableRecordingDirectory(
      restartedSettings.recordingSaveDirectory,
      documentsDirectory,
    ),
    path.normalize(customDirectory),
  );
  assert.equal(restartedSettings.recordingSaveDirectory, customDirectory);
});

test("recording directory rejects damaged values and uses Documents/ShangHao recordings", () => {
  const documentsDirectory = path.resolve("test-documents");
  assert.equal(
    resolveRecordingDirectory(path.join("..", "unsafe"), documentsDirectory),
    path.join(documentsDirectory, RECORDING_DIRECTORY_NAME),
  );
});

test("recording directory temporarily falls back when the saved folder is unavailable", async () => {
  const documentsDirectory = path.resolve("test-documents");
  const customDirectory = path.resolve("unavailable-custom-recordings");
  const fallbackDirectory = path.join(documentsDirectory, RECORDING_DIRECTORY_NAME);
  const checkedDirectories: string[] = [];

  const resolvedDirectory = await resolveUsableRecordingDirectory(
    customDirectory,
    documentsDirectory,
    async (directory) => {
      checkedDirectories.push(directory);
      if (directory === customDirectory) throw new Error("EACCES");
    },
  );

  assert.equal(resolvedDirectory, fallbackDirectory);
  assert.deepEqual(checkedDirectories, [customDirectory, fallbackDirectory]);
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
