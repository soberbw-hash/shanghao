import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  preparePersistentAiStorage,
  resolvePersistentAiStoragePaths,
} from "../src/main/ai-storage";

test("development and packaged builds resolve one version-independent local AI directory", () => {
  const localAppDataDirectory = "C:\\Users\\tester\\AppData\\Local";
  const paths = resolvePersistentAiStoragePaths({
    appDataDirectory: "C:\\Users\\tester\\AppData\\Roaming",
    localAppDataDirectory,
  });
  assert.equal(paths.root, path.join(localAppDataDirectory, "ShangHao", "AI"));
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

test("migration leaves unreadable destination state untouched and does not mark completion", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-storage-damaged-"));
  try {
    const userData = path.join(temporaryRoot, "legacy-user-data");
    const appData = path.join(temporaryRoot, "AppData", "Roaming");
    const localAppData = path.join(temporaryRoot, "AppData", "Local");
    const destination = path.join(localAppData, "ShangHao", "AI");
    const statePath = path.join(destination, "models", "state.json");
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, "damaged model state", "utf8");

    await assert.rejects(
      preparePersistentAiStorage({
        userDataDirectory: userData,
        appDataDirectory: appData,
        localAppDataDirectory: localAppData,
        writeLog: async () => undefined,
      }),
    );
    assert.equal(await readFile(statePath, "utf8"), "damaged model state");
    assert.equal((await readdir(destination)).includes(".legacy-migration-v1.json"), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("migration does not mistake a partial completion marker for a finished migration", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-marker-damaged-"));
  try {
    const userData = path.join(temporaryRoot, "legacy-user-data");
    const appData = path.join(temporaryRoot, "AppData", "Roaming");
    const localAppData = path.join(temporaryRoot, "AppData", "Local");
    const destination = path.join(localAppData, "ShangHao", "AI");
    const markerPath = path.join(destination, ".legacy-migration-v1.json");
    const sourceFile = path.join(userData, "ai-models", "model-a", "weights.bin");
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, "legacy weights", "utf8");
    await mkdir(destination, { recursive: true });
    await writeFile(markerPath, "{", "utf8");

    const paths = await preparePersistentAiStorage({
      userDataDirectory: userData,
      appDataDirectory: appData,
      localAppDataDirectory: localAppData,
      writeLog: async () => undefined,
    });
    assert.equal(
      await readFile(path.join(paths.models, "model-a", "weights.bin"), "utf8"),
      "legacy weights",
    );
    assert.equal(
      (JSON.parse(await readFile(markerPath, "utf8")) as { legacyDirectoriesRetained?: boolean })
        .legacyDirectoriesRetained,
      true,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("migration does not mark completion after a legacy model copy fails", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-copy-failure-"));
  try {
    const userData = path.join(temporaryRoot, "legacy-user-data");
    const appData = path.join(temporaryRoot, "AppData", "Roaming");
    const localAppData = path.join(temporaryRoot, "AppData", "Local");
    const destination = path.join(localAppData, "ShangHao", "AI");
    const sourceFile = path.join(userData, "ai-models", "model-a", "weights.bin");
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, "legacy weights", "utf8");
    await mkdir(path.join(destination, "models", "model-a", "weights.bin"), {
      recursive: true,
    });
    const messages: string[] = [];

    await assert.rejects(
      preparePersistentAiStorage({
        userDataDirectory: userData,
        appDataDirectory: appData,
        localAppDataDirectory: localAppData,
        writeLog: async (payload) => {
          messages.push(payload.message);
        },
      }),
      /ai_model_storage_migration_incomplete/,
    );
    assert.equal(messages.includes("ai_model_storage_migration_failed"), true);
    assert.equal(await readFile(sourceFile, "utf8"), "legacy weights");
    assert.equal((await readdir(destination)).includes(".legacy-migration-v1.json"), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("migration leaves a failed runtime copy eligible for retry", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "shanghao-ai-runtime-copy-"));
  try {
    const userData = path.join(temporaryRoot, "legacy-user-data");
    const appData = path.join(temporaryRoot, "AppData", "Roaming");
    const localAppData = path.join(temporaryRoot, "AppData", "Local");
    const destination = path.join(localAppData, "ShangHao", "AI");
    const sourceFile = path.join(userData, "ai-runtimes", "runtime-a", "runtime.dll");
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, "legacy runtime", "utf8");
    await mkdir(path.join(destination, "runtimes", "runtime-a", "runtime.dll"), {
      recursive: true,
    });

    await assert.rejects(
      preparePersistentAiStorage({
        userDataDirectory: userData,
        appDataDirectory: appData,
        localAppDataDirectory: localAppData,
        writeLog: async () => undefined,
      }),
      /ai_runtime_storage_migration_incomplete/,
    );
    assert.equal(await readFile(sourceFile, "utf8"), "legacy runtime");
    assert.equal((await readdir(destination)).includes(".legacy-migration-v1.json"), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
