import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  preparePersistentAiStorage,
  resolvePersistentAiStoragePaths,
} from "../src/main/ai-storage";

test("development and packaged builds resolve one version-independent local AI directory", () => {
  const paths = resolvePersistentAiStoragePaths({
    appDataDirectory: "C:\\Users\\tester\\AppData\\Roaming",
    localAppDataDirectory: "C:\\Users\\tester\\AppData\\Local",
  });
  assert.equal(paths.root, "C:\\Users\\tester\\AppData\\Local\\ShangHao\\AI");
  assert.equal(paths.models, path.join(paths.root, "models"));
  assert.equal(paths.runtimes, path.join(paths.root, "runtimes"));
  assert.equal(paths.root.includes("2.8.0"), false);
  assert.equal(paths.root.includes("node_modules"), false);
});

test("legacy userData models are copied once while the original remains recoverable", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-storage-"));
  const userData = path.join(temporaryRoot, "legacy-user-data");
  const appData = path.join(temporaryRoot, "AppData", "Roaming");
  const localAppData = path.join(temporaryRoot, "AppData", "Local");
  const legacyFile = path.join(userData, "ai-models", "vibevoice", "partial.bin");
  await import("node:fs/promises").then(({ mkdir }) =>
    mkdir(path.dirname(legacyFile), { recursive: true }),
  );
  await writeFile(legacyFile, "resume-me", "utf8");

  const logs: string[] = [];
  const paths = await preparePersistentAiStorage({
    userDataDirectory: userData,
    appDataDirectory: appData,
    localAppDataDirectory: localAppData,
    writeLog: async (payload) => {
      logs.push(payload.message);
    },
  });

  assert.equal(
    await readFile(path.join(paths.models, "vibevoice", "partial.bin"), "utf8"),
    "resume-me",
  );
  assert.equal(await readFile(legacyFile, "utf8"), "resume-me");
  assert.equal(logs.includes("ai_storage_migrated"), true);

  await rm(temporaryRoot, { recursive: true, force: true });
});

test("migration prefers a completed packaged model over a partial development download", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-storage-merge-"));
  const appData = path.join(temporaryRoot, "AppData", "Roaming");
  const localAppData = path.join(temporaryRoot, "AppData", "Local");
  const developmentRoot = path.join(appData, "shanghao-desktop", "ai-models");
  const packagedRoot = path.join(appData, "ShangHao", "ai-models");
  const revision = "recommended-revision";
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(developmentRoot, "qwen35-4b", revision), { recursive: true });
  await mkdir(path.join(packagedRoot, "qwen35-4b", revision), { recursive: true });
  await writeFile(
    path.join(developmentRoot, "state.json"),
    JSON.stringify({
      models: {
        "qwen35-4b": {
          userInstalled: true,
          phase: "paused",
          pendingRevision: revision,
          downloadedBytes: 40,
          totalBytes: 100,
        },
      },
      taskCheckpoints: {},
    }),
  );
  await writeFile(path.join(developmentRoot, "qwen35-4b", revision, "weights.part"), "partial");
  await writeFile(
    path.join(packagedRoot, "state.json"),
    JSON.stringify({
      models: {
        "qwen35-4b": {
          userInstalled: true,
          phase: "installed",
          activeRevision: revision,
          downloadedBytes: 100,
          totalBytes: 100,
        },
      },
      taskCheckpoints: {},
    }),
  );
  await writeFile(path.join(packagedRoot, "qwen35-4b", revision, "model.ready.json"), "{}");

  const paths = await preparePersistentAiStorage({
    userDataDirectory: path.join(appData, "shanghao-desktop"),
    appDataDirectory: appData,
    localAppDataDirectory: localAppData,
    writeLog: async () => undefined,
  });
  const state = JSON.parse(await readFile(path.join(paths.models, "state.json"), "utf8")) as {
    models: Record<string, { phase: string; activeRevision?: string }>;
  };
  assert.equal(state.models["qwen35-4b"]?.phase, "installed");
  assert.equal(state.models["qwen35-4b"]?.activeRevision, revision);
  assert.equal(
    await readFile(path.join(paths.models, "qwen35-4b", revision, "model.ready.json"), "utf8"),
    "{}",
  );

  await rm(temporaryRoot, { recursive: true, force: true });
});
