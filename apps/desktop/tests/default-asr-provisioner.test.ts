import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AiModelAction, AiModelStatus } from "@private-voice/shared";
import {
  baselineAsrStatus,
  createDefaultAsrProvisioner,
} from "../src/main/default-asr-provisioner";
import { AiModelManager } from "../src/main/ai-model-manager";
import { defaultSettings } from "../src/main/settings-migration";
import { requestBaselineAsr } from "../src/main/baseline-asr-ownership";

test("fresh setup persists exactly the baseline and required aligner, once", async () => {
  const state: { baselineAsrRequested?: boolean } = {};
  const entries = new Map<string, { userInstalled: boolean; phase: "not_installed" }>();
  const started: string[] = [];
  let saves = 0;
  const get = (id: string) => {
    if (!entries.has(id)) entries.set(id, { userInstalled: false, phase: "not_installed" });
    return entries.get(id)!;
  };
  for (let round = 0; round < 2; round++)
    await requestBaselineAsr(
      true,
      state,
      get,
      async () => {
        saves++;
      },
      (id) => started.push(id),
      ["qwen3-forced-aligner-0.6b"],
    );
  assert.deepEqual(started, ["qwen3-asr-0.6b-force", "qwen3-forced-aligner-0.6b"]);
  assert.equal(saves, 1);
  assert.ok([...entries.values()].every((entry) => entry.userInstalled));
});

const base = {
  id: "qwen3-asr-0.6b-force",
  phase: "installed",
  userInstalled: true,
  activeRevision: "pinned",
  runtimeReady: false,
} as AiModelStatus;
test("baseline repairs only its own runtime, respects pressure and backoff, and announces readiness once", async (t) => {
  let model = { ...base },
    clock = 0,
    canPrepare = false,
    ready = 0;
  const actions: AiModelAction[] = [];
  const provision = createDefaultAsrProvisioner({
    enabled: () => true,
    model: () => model,
    optIn: async () => true,
    control: async (action) => {
      actions.push(action);
      throw Error("runtime_not_ready");
    },
    canPrepare: () => canPrepare,
    onReady: () => ready++,
    now: () => clock,
  });
  t.after(() => provision.stop());
  await provision.check();
  assert.deepEqual(actions, []);
  canPrepare = true;
  await provision.check();
  assert.deepEqual(actions, ["repair"]);
  await provision.check();
  assert.equal(actions.length, 1);
  clock = 60000;
  await provision.check();
  assert.equal(actions.length, 2);
  clock = 120000;
  await provision.check();
  assert.equal(actions.length, 2);
  model = { ...base, runtimeReady: true };
  await provision.check();
  await provision.check();
  assert.equal(ready, 1);
  canPrepare = false;
  await provision.check();
  canPrepare = true;
  await provision.check();
  assert.equal(ready, 2);
});
test("dependency network errors recover while explicit pause and removal remain authoritative", async (t) => {
  const aligner = {
    ...base,
    id: "qwen3-forced-aligner-0.6b",
    activeRevision: undefined,
    phase: "error",
    failureKind: "network",
  } as AiModelStatus;
  const primary = { ...base, dependencies: ["qwen3-forced-aligner-0.6b"] } as AiModelStatus;
  assert.equal(baselineAsrStatus([primary, aligner])?.activeRevision, undefined);
  assert.equal(baselineAsrStatus([primary])?.phase, "not_installed");
  assert.equal(
    baselineAsrStatus([primary, { ...aligner, userInstalled: false }])?.userInstalled,
    false,
  );
  let model = baselineAsrStatus([primary, aligner])!,
    owned = true,
    clock = 0;
  const actions: AiModelAction[] = [];
  const provision = createDefaultAsrProvisioner({
    enabled: () => true,
    model: () => model,
    optIn: async () => owned,
    control: async (action) => {
      actions.push(action);
    },
    canPrepare: () => true,
    onReady: () => {},
    now: () => clock,
  });
  t.after(() => provision.stop());
  await provision.check();
  assert.deepEqual(actions, ["download"]);
  clock = 1;
  await provision.check();
  assert.equal(actions.length, 1);
  model = { ...model, phase: "paused" };
  clock = 100000;
  await provision.check();
  assert.equal(actions.length, 1);
  owned = false;
  model = { ...model, phase: "not_installed" };
  await provision.check();
  assert.equal(actions.length, 1);
  assert.equal(defaultSettings.aiTranscriptionProvider, "cloud");
  assert.equal(defaultSettings.isAiCloudLocalAssistEnabled, true);
  assert.equal(defaultSettings.aiCloudLocalAsrModel, "qwen3-asr-0.6b-force");
  assert.equal(defaultSettings.isAiAutoTranscribeEnabled, true);
  assert.equal(defaultSettings.isAiAutoOrganizeEnabled, true);
  assert.equal(defaultSettings.isAiAutoUploadEnabled, false);
});
test("baseline ownership survives restart without resuming a user-paused download", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-baseline-owner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "state.json"),
    JSON.stringify({
      baselineAsrRequested: true,
      models: { "qwen3-asr-0.6b-force": { userInstalled: true, phase: "paused" } },
      taskCheckpoints: {},
    }),
  );
  let calls = 0;
  const manager = new AiModelManager(
    directory,
    { getSnapshot: () => ({}), onDetected: () => () => {} } as never,
    async () => {},
    async () => {
      calls++;
      throw Error("must_not_download");
    },
  );
  t.after(() => manager.stop());
  await manager.initialize("low_resource");
  assert.equal(await manager.requestBaselineAsr(), true);
  assert.equal(manager.getSnapshot().models.find((model) => model.id === base.id)?.phase, "paused");
  assert.equal(calls, 0);
  const saved = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
  assert.equal(saved.baselineAsrRequested, true);
});
