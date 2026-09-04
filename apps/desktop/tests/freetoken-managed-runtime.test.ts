import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import assert from "node:assert/strict";

import {
  FreeTokenManagedRuntime,
  parseFreeTokenWindowsAssetPair,
} from "../src/main/freetoken-managed-runtime";
import { FreeTokenLocalLlmProvider } from "../src/main/freetoken-local-llm-provider";

const row = (name: string, digest: string, updatedAt: string): string => `
  <li class="Box-row">
    <a href="/FlashML-org/FreeToken-Web/releases/download/beta/${name}">${name}</a>
    <span>sha256:${digest}</span>
    <relative-time datetime="${updatedAt}"></relative-time>
  </li>`;

test("FreeToken release parser selects the newest matching Windows wheel pair", () => {
  const oldDigest = "a".repeat(64);
  const newDigest = "b".repeat(64);
  const html = [
    row("freetoken-0.1.2+g111111111-cp312-cp312-win_amd64.whl", oldDigest, "2026-08-20T00:00:00Z"),
    row(
      "freetoken_kernel_cache-0.1.2+cu130.g111111111-py3-none-win_amd64.whl",
      oldDigest,
      "2026-08-20T00:00:01Z",
    ),
    row("freetoken-0.1.2+g222222222-cp312-cp312-win_amd64.whl", newDigest, "2026-08-31T00:00:00Z"),
    row(
      "freetoken_kernel_cache-0.1.2+cu130.g222222222-py3-none-win_amd64.whl",
      newDigest,
      "2026-08-31T00:00:01Z",
    ),
    row(
      "freetoken-0.1.2+g333333333-cp312-cp312-linux_x86_64.whl",
      newDigest,
      "2026-09-01T00:00:00Z",
    ),
  ].join("\n");

  const pair = parseFreeTokenWindowsAssetPair(html);
  assert.equal(pair.runtime.buildCommit, "222222222");
  assert.equal(pair.kernelCache.buildCommit, "222222222");
  assert.match(pair.runtime.name, /cp312-cp312-win_amd64/);
  assert.match(pair.kernelCache.name, /py3-none-win_amd64/);
  assert.equal(pair.runtime.sha256, newDigest);
});

test("FreeToken runtime reuses an existing CLI without downloading Desktop or another runtime", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-freetoken-managed-"));
  const legacyCli = path.join(directory, "existing", "ft.exe");
  await mkdir(path.dirname(legacyCli), { recursive: true });
  await writeFile(legacyCli, "placeholder", "utf8");
  let fetchCalled = false;
  try {
    const runtime = new FreeTokenManagedRuntime(path.join(directory, "runtime"), {
      legacyExecutablePaths: [legacyCli],
      fetcher: async () => {
        fetchCalled = true;
        throw new Error("network_should_not_be_used");
      },
      runProcess: async (executable, args) => {
        assert.equal(executable, legacyCli);
        assert.deepEqual(args, ["--version"]);
        return { stdout: "freetoken 0.1.2+test\n", stderr: "" };
      },
    });
    const status = await runtime.prepare();
    assert.equal(status.ready, true);
    assert.equal(status.managed, false);
    assert.equal(status.executable, legacyCli);
    assert.equal(status.version, "0.1.2+test");
    assert.equal(fetchCalled, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("FreeToken release parser refuses an unpaired or Linux-only release", () => {
  const html = row(
    "freetoken-0.1.2+g111111111-cp312-cp312-linux_x86_64.whl",
    "c".repeat(64),
    "2026-08-31T00:00:00Z",
  );
  assert.throws(() => parseFreeTokenWindowsAssetPair(html), /windows_release_pair_missing/);
});

test("local organizer automatically prepares its managed runtime on first use", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "shanghao-freetoken-provider-"));
  const previousEnvironment = {
    path: process.env.PATH,
    freetokenHome: process.env.FREETOKEN_HOME,
    localAppData: process.env.LOCALAPPDATA,
    appData: process.env.APPDATA,
    programFiles: process.env.ProgramFiles,
    explicitCli: process.env.SHANGHAO_FREETOKEN_CLI,
    desktopCli: process.env.FREETOKEN_FT_BIN,
  };
  let prepareCalls = 0;
  try {
    await writeFile(path.join(directory, "model.safetensors.index.json"), "{}", "utf8");
    process.env.PATH = "";
    delete process.env.FREETOKEN_HOME;
    delete process.env.LOCALAPPDATA;
    delete process.env.APPDATA;
    delete process.env.ProgramFiles;
    delete process.env.SHANGHAO_FREETOKEN_CLI;
    delete process.env.FREETOKEN_FT_BIN;

    const provider = new FreeTokenLocalLlmProvider(
      () => directory,
      "test-revision",
      undefined,
      29_193,
      () => undefined,
      async () => {
        prepareCalls += 1;
        return process.execPath;
      },
    );
    const status = await provider.prepare();
    provider.stop();

    assert.equal(prepareCalls, 1);
    assert.equal(status.ready, true);
    assert.equal(status.metrics.phase, "stopped");
  } finally {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("PATH", previousEnvironment.path);
    restore("FREETOKEN_HOME", previousEnvironment.freetokenHome);
    restore("LOCALAPPDATA", previousEnvironment.localAppData);
    restore("APPDATA", previousEnvironment.appData);
    restore("ProgramFiles", previousEnvironment.programFiles);
    restore("SHANGHAO_FREETOKEN_CLI", previousEnvironment.explicitCli);
    restore("FREETOKEN_FT_BIN", previousEnvironment.desktopCli);
    await rm(directory, { recursive: true, force: true });
  }
});
