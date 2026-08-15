import { existsSync } from "node:fs";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RendererLogPayload } from "@private-voice/shared";

export interface PersistentAiStoragePaths {
  root: string;
  models: string;
  runtimes: string;
}

interface PreparePersistentAiStorageOptions {
  userDataDirectory: string;
  appDataDirectory: string;
  localAppDataDirectory?: string;
  isolateDirectory?: string;
  writeLog: (payload: RendererLogPayload) => Promise<void>;
}

export const resolvePersistentAiStoragePaths = ({
  appDataDirectory,
  localAppDataDirectory,
  isolateDirectory,
}: Pick<
  PreparePersistentAiStorageOptions,
  "appDataDirectory" | "localAppDataDirectory" | "isolateDirectory"
>): PersistentAiStoragePaths => {
  const localRoot = isolateDirectory
    ? path.join(isolateDirectory, "ai")
    : path.join(
        localAppDataDirectory?.trim() || path.resolve(appDataDirectory, "..", "Local"),
        "ShangHao",
        "AI",
      );
  return {
    root: localRoot,
    models: path.join(localRoot, "models"),
    runtimes: path.join(localRoot, "runtimes"),
  };
};

interface LegacyAiState {
  models?: Record<
    string,
    {
      userInstalled?: boolean;
      activeRevision?: string;
      pendingRevision?: string;
      phase?: string;
      downloadedBytes?: number;
      totalBytes?: number;
      errorMessage?: string;
    }
  >;
  taskCheckpoints?: Record<string, unknown>;
}

const readLegacyAiState = async (directory: string): Promise<LegacyAiState | undefined> => {
  try {
    return JSON.parse(await readFile(path.join(directory, "state.json"), "utf8")) as LegacyAiState;
  } catch {
    return undefined;
  }
};

const modelStateScore = (model: NonNullable<LegacyAiState["models"]>[string]): number => {
  if (model.activeRevision && model.phase === "installed") return 10_000;
  if (model.activeRevision) return 9_000;
  const progress =
    model.totalBytes && model.downloadedBytes
      ? Math.min(1, model.downloadedBytes / model.totalBytes)
      : 0;
  return (model.userInstalled ? 1_000 : 0) + Math.round(progress * 500);
};

const mergeLegacyAiStates = async (sources: string[], destination: string): Promise<void> => {
  const states = (
    await Promise.all([...sources, destination].map((directory) => readLegacyAiState(directory)))
  ).filter((state): state is LegacyAiState => Boolean(state));
  if (states.length === 0) return;

  const merged: Required<LegacyAiState> = { models: {}, taskCheckpoints: {} };
  for (const state of states) {
    Object.assign(merged.taskCheckpoints, state.taskCheckpoints ?? {});
    for (const [id, model] of Object.entries(state.models ?? {})) {
      const current = merged.models[id];
      if (!current || modelStateScore(model) > modelStateScore(current)) {
        merged.models[id] = model;
      }
    }
  }
  await writeFile(path.join(destination, "state.json"), JSON.stringify(merged, null, 2), "utf8");
};

const copyLegacyDirectory = async (
  source: string,
  destination: string,
  writeLog: PreparePersistentAiStorageOptions["writeLog"],
): Promise<boolean> => {
  if (!existsSync(source)) return false;
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: false, errorOnExist: false });
  await writeLog({
    category: "app",
    level: "info",
    message: "ai_storage_migrated",
    context: { source, destination, legacyCopyRetained: true },
  });
  return true;
};

export const preparePersistentAiStorage = async (
  options: PreparePersistentAiStorageOptions,
): Promise<PersistentAiStoragePaths> => {
  const paths = resolvePersistentAiStoragePaths(options);
  await mkdir(paths.root, { recursive: true });
  const migrationMarker = path.join(paths.root, ".legacy-migration-v1.json");

  if (existsSync(migrationMarker)) {
    await mkdir(paths.models, { recursive: true });
    await mkdir(paths.runtimes, { recursive: true });
    return paths;
  }

  const knownUserDataDirectories = [
    options.userDataDirectory,
    path.join(options.appDataDirectory, "shanghao-desktop"),
    path.join(options.appDataDirectory, "ShangHao"),
    path.join(options.appDataDirectory, "上号"),
  ].filter((directory, index, all) => all.indexOf(directory) === index);

  const legacyModelDirectories = knownUserDataDirectories.map((directory) =>
    path.join(directory, "ai-models"),
  );
  for (const legacyModelDirectory of legacyModelDirectories) {
    try {
      await copyLegacyDirectory(legacyModelDirectory, paths.models, options.writeLog);
    } catch (error) {
      await options.writeLog({
        category: "app",
        level: "warn",
        message: "ai_model_storage_migration_failed",
        context: {
          source: legacyModelDirectory,
          destination: paths.models,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  await mergeLegacyAiStates(legacyModelDirectories, paths.models);

  for (const userDataDirectory of knownUserDataDirectories) {
    try {
      await copyLegacyDirectory(
        path.join(userDataDirectory, "ai-runtimes"),
        paths.runtimes,
        options.writeLog,
      );
    } catch (error) {
      await options.writeLog({
        category: "app",
        level: "warn",
        message: "ai_runtime_storage_migration_failed",
        context: {
          source: path.join(userDataDirectory, "ai-runtimes"),
          destination: paths.runtimes,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  await mkdir(paths.models, { recursive: true });
  await mkdir(paths.runtimes, { recursive: true });
  await writeFile(
    migrationMarker,
    JSON.stringify(
      {
        migratedAt: new Date().toISOString(),
        legacyDirectoriesRetained: true,
      },
      null,
      2,
    ),
    "utf8",
  );
  return paths;
};
